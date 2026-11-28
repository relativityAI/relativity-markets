import { Suspense, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import {
  Routes,
  Route,
  useLocation,
  useParams,
  Navigate
} from 'react-router';

import { Box, Flex, Spinner, Center } from "@/compat/ui";
import { AuthProvider } from "./auth/AuthContext";
import { useAuth } from "./auth/useAuth";
import Login from "./pages/Login";
import AuthCallback from "./pages/AuthCallback";
import HomePage from "./pages/HomePage";
import Watchlists from "./pages/Watchlists";
import AnalysisList from "./pages/AnalysisList";
import Analysis from "./pages/Analysis";
import AnalysisResult from "./pages/AnalysisResult";
import Stock from "./pages/Stock";
import Group from "./pages/Group";
import Sectors from "./pages/Sectors";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import ThankYou from "./pages/ThankYou";
import NavBar from "./components/NavBar";
import Footer from "./components/Footer";
import ApiKeySetupDialog from "./components/ApiKeySetupDialog";
import RunWatcher from "./components/RunWatcher";
import { MotionConfig, AnimatePresence, motion } from "motion/react";
import { page, dur, ease } from "@/lib/motion";
import { Toaster } from "./components/ui/toaster";
// My Workspace — plugins + active runs (shell + the plugin directory).
import ConsoleLayout from "./pages/console/ConsoleLayout";
import PluginLibrary from "./pages/console/PluginLibrary";
import PluginDetail from "./pages/plugins/PluginDetail";

// App is usable without a sign-in — no auth gate, no redirect to /login.
function Protected({ children }: { children: ReactNode }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key="content" style={{ height: "100%" }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: dur.base, ease }}>
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

function Home() {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key="home" style={{ height: "100%" }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: dur.base, ease }}>
        <HomePage />
      </motion.div>
    </AnimatePresence>
  );
}

function PageFallback() {
  return (
    <Center minH="60vh">
      <Spinner size="lg" />
    </Center>
  );
}

function UnknownRoute() {
  const { user, loading } = useAuth();
  if (loading) return <PageFallback />;
  return user ? <Navigate to="/" replace /> : <NotFound />;
}

/** Old agent editor URLs open the workspace (agents are gone → plugins). */
function AgentRedirect() {
  return <Navigate to="/my-workspace" replace />;
}

/** Old run-result URLs → /runs/:id (same result page). */
function LegacyRunResultRedirect() {
  const { id } = useParams();
  return <Navigate to={`/runs/${encodeURIComponent(id ?? "")}`} replace />;
}

/** Old /console URLs → /my-workspace, keeping the sub-path and query. */
function ConsoleLegacyRedirect() {
  const location = useLocation();
  return (
    <Navigate
      to={location.pathname.replace(/^\/console/, "/my-workspace") + location.search}
      replace
    />
  );
}

const PUBLIC_PATHS = ["/login", "/privacy", "/terms", "/thank-you", "/auth/callback"];

function AppRoutes() {
  const location = useLocation();
  const locationPath = location.pathname;
  const { user } = useAuth();

  // The route container is the scroller (window stays fixed) — without this
  // the next page inherits the previous scroll offset, and a shorter page
  // clamps straight to its bottom.
  const scrollRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    scrollRef.current?.scrollTo(0, 0);
  }, [locationPath]);

  useEffect(() => {
    const getTitle = (path: string) => {
      // One name per concept (same words as the nav): New Run / Runs / Workspace.
      if (path === "/login") return "Sign in";
      if (path === "/") return "Relativity";
      if (path === "/new-run" || path === "/new-analysis" || path === "/analysis") return "New Run";
      if (path === "/runs" || path === "/analysis-list") return "Runs";
      if (path === "/watchlists") return "Watchlist";
      if (path.startsWith("/runs/") || path.startsWith("/analysis-result/")) return "Run Result";
      if (path.startsWith("/plugins/")) return "Plugin";
      if (path.startsWith("/stock/")) return "Stock";
      if (path === "/settings") return "Settings";
      if (path === "/my-workspace" || path.startsWith("/my-workspace/")) return "Workspace";
      return "Relativity";
    };

    const title = getTitle(locationPath);
    document.title = title === "Relativity" ? "Relativity" : `${title} | Relativity`;
  }, [locationPath, user]);

  const isLogin = locationPath === "/login";
  const isConsole = locationPath.startsWith("/my-workspace") || locationPath.startsWith("/plugins");
  const isPublicPage = PUBLIC_PATHS.includes(locationPath);
  // The new run page owns the whole viewport — no footer under it.
  // "/" is always footerless: HomePage renders its own.
  // /runs (+ result) keep the old /analysis* footerless behavior.
  const isAnalysisPage =
    locationPath.startsWith("/analysis") ||
    locationPath === "/new-run" ||
    locationPath === "/runs" ||
    locationPath.startsWith("/runs/") ||
    locationPath === "/" ||
    locationPath === "/watchlists" ||
    locationPath.startsWith("/agent/");
  const showNav = !isLogin;
  // Remove footer from analysis result page (and analysis-related pages as requested)
  const showFooter = showNav && !isPublicPage && !isConsole && !isAnalysisPage && locationPath !== "/settings" && !locationPath.startsWith("/stock") && !locationPath.startsWith("/group") && locationPath !== "/sectors";

  return (
    <Flex direction="column" h="100dvh" overflow="hidden">
      {/* First tab stop on every page — the audit's "first 5 stops are the
          data-source chips" defect. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[2000] focus:rounded-[2px] focus:border focus:border-[var(--hairline)] focus:bg-[var(--surface-panel)] focus:px-3 focus:py-2 focus:font-[family-name:var(--font-body)] focus:text-sm focus:text-[var(--ink-primary)] focus:shadow-[0_8px_24px_rgba(0,0,0,0.2)]"
      >
        Skip to content
      </a>
      {user && locationPath !== "/settings" && <ApiKeySetupDialog key={user.id} user={user} />}
      {user && <RunWatcher />}
      {showNav && <NavBar />}

        {/* One natural page scroller for every route — no inner scroll boxes.
            This is the app's single <main> landmark (the console's inner
            container is a plain div so there is never a second one). */}
        <Box as="main" id="main-content" ref={scrollRef} w="100%" flex={1} overflowY="auto" overflowX="hidden" paddingX={0}>
            <AnimatePresence mode="wait">
              <motion.div key={isConsole ? "console" : location.pathname} variants={page} style={{ height: "100%", maxWidth: "1200px", margin: "0 auto", paddingLeft: "1.5rem", paddingRight: "1.5rem" }} initial="initial" animate="animate" exit="exit">
                <Suspense fallback={<PageFallback />}>
                  <Routes location={location}>
                    <Route path="/login" element={<Login />} />
                    <Route path="/auth/callback" element={<AuthCallback />} />
                    <Route path="/" element={<Home />} />
                    <Route path="/watchlists" element={<Watchlists />} />
                    {/* Legacy URLs → their new homes. */}
                    <Route path="/new-analysis" element={<Navigate to="/new-run" replace />} />
                    <Route path="/analysis-list" element={<Navigate to="/runs" replace />} />
                    <Route path="/analysis-result/:id" element={<LegacyRunResultRedirect />} />
                    <Route path="/analysis-result" element={<Navigate to="/runs" replace />} />
                    <Route path="/agents" element={<Navigate to="/my-workspace" replace />} />
                    <Route path="/agent" element={<Navigate to="/my-workspace" replace />} />
                    <Route path="/agent/builder" element={<AgentRedirect />} />
                    <Route path="/agent/builder/:id" element={<AgentRedirect />} />
                    <Route path="/agent/new" element={<AgentRedirect />} />
                    <Route path="/agent/:id" element={<AgentRedirect />} />
                    <Route path="/plugins" element={<Navigate to="/my-workspace" replace />} />
                    <Route
                      path="/runs"
                      element={
                        <Protected>
                          <AnalysisList />
                        </Protected>
                      }
                    />
                    <Route
                      path="/runs/:id"
                      element={
                        <Protected>
                          <AnalysisResult />
                        </Protected>
                      }
                    />
                    <Route
                      path="/new-run"
                      element={
                        <Protected>
                          <Analysis />
                        </Protected>
                      }
                    />
                    <Route
                      path="/analysis"
                      element={
                        <Protected>
                          <Analysis />
                        </Protected>
                      }
                    />
                    <Route
                      path="/analysis/:id"
                      element={
                        <Protected>
                          <Analysis />
                        </Protected>
                      }
                    />
                    <Route path="/stock/:symbol" element={<Stock />} />
                    <Route path="/group/:key" element={<Group />} />
                    <Route path="/sectors" element={<Sectors />} />
                    <Route
                      path="/settings"
                      element={
                        <Protected>
                          <Settings />
                        </Protected>
                      }
                    />
                    <Route path="/privacy" element={<Privacy />} />
                    <Route path="/terms" element={<Terms />} />
                    <Route path="/thank-you" element={<ThankYou />} />
                    <Route path="/index.html" element={<Navigate to="/" replace />} />
                    {/* My Workspace — plugins + active runs. */}
                    <Route
                      path="/my-workspace"
                      element={
                        <Protected>
                          <ConsoleLayout />
                        </Protected>
                      }
                    >
                      <Route index element={<PluginLibrary />} />
                    </Route>
                    {/* Plugin detail — its own page (Overview / Files). */}
                    <Route
                      path="/plugins/:id"
                      element={
                        <Protected>
                          <PluginDetail />
                        </Protected>
                      }
                    />
                    {/* Old /console URLs keep working. */}
                    <Route path="/console" element={<Navigate to="/my-workspace" replace />} />
                    <Route path="/console/*" element={<ConsoleLegacyRedirect />} />
                    <Route path="*" element={<UnknownRoute />} />
                  </Routes>
                </Suspense>
              </motion.div>
            </AnimatePresence>
        </Box>

      {showFooter && <Footer />}
      <Toaster />
    </Flex>
  );
}

function App() {
  return (
    <AuthProvider>
      <MotionConfig reducedMotion="user">
        <AppRoutes />
      </MotionConfig>
    </AuthProvider>
  )
}

export default App
