/**
 * Registers the step-up password modal with the axios interceptor.
 *
 * Mount once near the top of the app tree (JasminApp / SuperAdminApp).
 * When the interceptor receives a ``403 auth.step_up_required`` on
 * a destructive request, it calls into this provider's prompt; the
 * modal asks for the password and verifies it through the step-up
 * endpoint, which swaps the rotated access token in, and the
 * interceptor retries the original request. With
 * ``STEP_UP_REQUIRES_TOTP`` on, the backend answers a user who has an
 * authenticator device with ``auth.two_factor.code_required``; the
 * modal then asks for the code as well and sends both.
 *
 * Why a provider (not a hook): the prompt has to live OUTSIDE any
 * specific React tree path so it can fire from background queries,
 * mutations, and code triggered by route changes. A component
 * mounted once high in the tree is the simplest answer.
 */

import { SafetyOutlined } from "@ant-design/icons";
import { Alert, Form, Input, Modal, Typography } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  registerStepUpPrompt,
  type StepUpCredentials,
  type StepUpPromptArgs,
} from "@shared/services/stepUp";
import { getErrorCode, getErrorMessage } from "@shared/utils/apiError";

const { Text } = Typography;

interface StepUpFormValues {
  password: string;
  totpCode?: string;
}

interface PromptResolver {
  /** Resolve the prompt promise — only after ``verify`` succeeded. */
  resolve: () => void;
  reject: (reason: unknown) => void;
}

export function StepUpProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  // ``open`` and ``ttlSeconds`` live in ONE state object so the modal
  // can never render open with a TTL from a previous prompt — the two
  // values update in the same commit by construction, instead of
  // relying on React's batching of two separate setState calls.
  const [promptState, setPromptState] = useState<{
    open: boolean;
    ttlSeconds: number;
  }>({
    open: false,
    ttlSeconds: 300,
  });
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Set once the backend asked this prompt for an authenticator code.
  const [needsCode, setNeedsCode] = useState(false);
  const resolverRef = useRef<PromptResolver | null>(null);
  const verifyRef = useRef<
    ((creds: StepUpCredentials) => Promise<void>) | null
  >(null);
  const [form] = Form.useForm<StepUpFormValues>();

  // Register the prompt at mount and tear it down on unmount. The
  // registry is module-level so there must be exactly one provider
  // alive at a time.
  useEffect(() => {
    registerStepUpPrompt((args: StepUpPromptArgs) => {
      setErrorMessage(null);
      setNeedsCode(false);
      form.resetFields();
      verifyRef.current = args.verify;
      setPromptState({ open: true, ttlSeconds: args.ttlSeconds });
      return new Promise<void>((resolve, reject) => {
        resolverRef.current = { resolve, reject };
      });
    });
    return () => {
      // Settle a pending prompt before unregistering: if the provider
      // unmounts mid-prompt (e.g. an ErrorBoundary swapping to its
      // fallback), an unsettled promise would keep ``runStepUpFlow``'s
      // ``finally`` from running, wedging its ``inFlight`` dedup for
      // every future destructive request until a full page reload.
      resolverRef.current?.reject(new Error("StepUpProvider unmounted"));
      resolverRef.current = null;
      verifyRef.current = null;
      registerStepUpPrompt(null);
    };
  }, [form]);

  const handleSubmit = useCallback(
    async (values: StepUpFormValues) => {
      const resolver = resolverRef.current;
      const verify = verifyRef.current;
      if (!resolver || !verify) return;
      setSubmitting(true);
      setErrorMessage(null);
      try {
        // Verify BEFORE resolving: a wrong password keeps the modal
        // open with the error instead of failing the original action.
        await verify({
          password: values.password,
          totpCode: needsCode ? values.totpCode : undefined,
        });
        resolver.resolve();
        resolverRef.current = null;
        verifyRef.current = null;
        setPromptState((prev) => ({ ...prev, open: false }));
      } catch (err) {
        const code = getErrorCode(err);
        if (code === "auth.two_factor.code_required") {
          // The password was right; keep it and ask for the code too.
          setNeedsCode(true);
          return;
        }
        setErrorMessage(getErrorMessage(err, t("auth.step_up.failed")));
        // A wrong code costs only the code, not the password typed above.
        form.resetFields(
          code === "auth.two_factor.invalid_code" ? ["totpCode"] : undefined,
        );
      } finally {
        setSubmitting(false);
      }
    },
    [form, needsCode, t],
  );

  const handleCancel = useCallback(() => {
    const resolver = resolverRef.current;
    if (resolver) {
      resolver.reject(new Error("step-up cancelled by user"));
      resolverRef.current = null;
      verifyRef.current = null;
    }
    setPromptState((prev) => ({ ...prev, open: false }));
  }, []);

  const ttlMinutes = Math.round(promptState.ttlSeconds / 60);

  return (
    <>
      {children}
      <Modal
        title={
          <span className="icon-title-row">
            {t("auth.step_up.title")}
          </span>
        }
        open={promptState.open}
        onCancel={handleCancel}
        okText={t("auth.step_up.submit")}
        cancelText={t("common.cancel")}
        onOk={() => form.submit()}
        confirmLoading={submitting}
        wrapClassName="step-up-modal"
        destroyOnHidden
      >
        <Text type="secondary">
          {t("auth.step_up.description")}
        </Text>

        {errorMessage && (
          <Alert
            type="error"
            showIcon
            message={errorMessage}
            className="step-up-modal__error"
          />
        )}

        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          className="step-up-modal__form"
        >
          <Form.Item
            name="password"
            label={t("auth.step_up.password")}
            rules={[
              {
                required: true,
                message: t("auth.step_up.password_required"),
              },
            ]}
          >
            <Input.Password autoFocus autoComplete="current-password" />
          </Form.Item>
          {needsCode && (
            <>
              <Text type="secondary" className="step-up-modal__code-prompt">
                {t("auth.two_factor.prompt_subtitle")}
              </Text>
              <Form.Item
                name="totpCode"
                label={t("auth.two_factor.code_label")}
                rules={[
                  {
                    required: true,
                    message: t("auth.two_factor.please_enter_code"),
                  },
                ]}
                extra={t("auth.two_factor.recovery_hint")}
              >
                <Input
                  prefix={<SafetyOutlined />}
                  placeholder="123456"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  maxLength={20}
                />
              </Form.Item>
            </>
          )}
          <Text type="secondary" className="step-up-modal__hint">
            {t(
              "auth.step_up.ttl_hint",
              { minutes: ttlMinutes },
            )}
          </Text>
        </Form>
      </Modal>
    </>
  );
}

export default StepUpProvider;
