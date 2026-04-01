import { Switch, Route } from "wouter";
import { LandingPage } from "./components/LandingPage";
import { GridApp } from "./components/GridApp";
import { PortfolioPage } from "./components/PortfolioPage";
import { LoginPage } from "./components/LoginPage";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { DocsPage } from "./components/DocsPage";

export default function App() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route path="/docs" component={DocsPage} />
      <Route path="/gridding">
        <ProtectedRoute>
          <GridApp />
        </ProtectedRoute>
      </Route>
      <Route path="/portfolio">
        <ProtectedRoute>
          <PortfolioPage />
        </ProtectedRoute>
      </Route>
      <Route>
        <LandingPage onEnter={() => (window.location.href = "/gridding")} />
      </Route>
    </Switch>
  );
}
