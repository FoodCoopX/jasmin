import type { TFunction } from "i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { notifyMock } = vi.hoisted(() => ({
  notifyMock: { warning: vi.fn() },
}));

vi.mock("@shared/utils", () => ({ notify: notifyMock }));

import { uploadPdfsWarningOnFailure } from "../uploadPdfsWarningOnFailure";

const t = ((key: string, options?: { count?: number }) =>
  `${key}:${options?.count}`) as unknown as TFunction;

beforeEach(() => {
  notifyMock.warning.mockReset();
});

describe("uploadPdfsWarningOnFailure", () => {
  it("runs the jobs one after the other and stays quiet when all succeed", async () => {
    const order: string[] = [];
    await uploadPdfsWarningOnFailure(
      [
        async () => {
          order.push("delivery note");
        },
        async () => {
          order.push("invoice");
        },
      ],
      t,
    );

    expect(order).toEqual(["delivery note", "invoice"]);
    expect(notifyMock.warning).not.toHaveBeenCalled();
  });

  it("keeps going past a failed job and warns once with the number that failed", async () => {
    const lastJob = vi.fn().mockResolvedValue(undefined);
    await uploadPdfsWarningOnFailure(
      [
        () => Promise.reject(new Error("render failed")),
        () => Promise.reject(new Error("upload failed")),
        lastJob,
      ],
      t,
    );

    expect(lastJob).toHaveBeenCalledTimes(1);
    expect(notifyMock.warning).toHaveBeenCalledTimes(1);
    expect(notifyMock.warning).toHaveBeenCalledWith(
      "commissioning.pdf_generation_failed:2",
    );
  });
});
