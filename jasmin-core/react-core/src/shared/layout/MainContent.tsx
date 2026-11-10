import { Layout } from "antd";
import { useLocation } from "react-router-dom";
import { AppRouter } from "@routing/AppRouter";
import ErrorBoundary from "@shared/ui/ErrorBoundary";

const { Content } = Layout;

export default function MainContent() {
  const location = useLocation();

  return (
    <Content
      // Skip-to-content target. tabIndex={-1} lets the skip link move
      // focus here programmatically without adding a Tab stop.
      id="main-content"
      tabIndex={-1}
      className="main-content"
    >
      {/* Per-route safety net: a page render-throw shows the fallback here,
          inside the persistent shell (nav/sidebar/footer survive). resetKeys
          on the route lets a click in the still-alive nav clear the fallback
          without a full reload. */}
      <ErrorBoundary resetKeys={[location.pathname]}>
        <AppRouter />
      </ErrorBoundary>
    </Content>
  );
}
