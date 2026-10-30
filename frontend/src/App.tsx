import { BrowserRouter, Routes, Route, Outlet } from "react-router-dom";
import { Suspense } from "react";
import { useHotkeys } from 'react-hotkeys-hook';

import "./App.css";
import { Header } from "./components/Header";
import { Home } from "./pages/Home";
import { FlowList } from "./components/FlowList";
import { FlowView } from "./pages/FlowView";
import { DiffView } from "./pages/DiffView";
import { Corrie } from "./components/Corrie";
import { Config } from "./pages/Config";
import { AuthWrapper } from "./components/AuthWrapper";
import { DarkModeProvider } from "./contexts/DarkModeContext";
import notFoundImage from "./404.png";

function App() {
  useHotkeys('esc', () => (document.activeElement as HTMLElement).blur(), {enableOnFormTags: true});
  return (
    <DarkModeProvider>
      <AuthWrapper>
        <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Home />} />
            <Route
              path="flow/:id"
              element={
                <Suspense>
                  <FlowView />
                </Suspense>
              }
            />
            <Route
              path="diff/:id"
              element={
                <Suspense>
                  <DiffView />
                </Suspense>
              }
            />
            <Route
              path="corrie/"
              element={
                <Suspense>
                  <Corrie />
                </Suspense>
              }
            />
            <Route
              path="config"
              element={
                <Suspense>
                  <Config />
                </Suspense>
              }
            />
          </Route>
          <Route path="*" element={<PageNotFound />} />
        </Routes>
      </BrowserRouter>
      </AuthWrapper>
    </DarkModeProvider>
  );
}

function Layout() {
  return (
    <div className="grid-container bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      <header className="header-area bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="header">
          <Header></Header>
        </div>
      </header>
      <aside className="flow-list-area bg-gray-50 dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700">
        <Suspense>
          <FlowList></FlowList>
        </Suspense>
      </aside>
      <main className="flow-details-area bg-white dark:bg-gray-900">
        <Outlet />
      </main>
      <footer className="footer-area bg-gray-50 dark:bg-gray-800"></footer>
    </div>
  );
}


function PageNotFound() {
  return (
    <div className="flex flex-col items-center justify-center h-full p-8 bg-white dark:bg-gray-900">
      <img src={notFoundImage} alt="404 - Page Not Found" className="max-w-md mb-4" />
      <h2 className="text-2xl font-bold text-gray-700 dark:text-gray-300">how the fuck did you end up here</h2>
    </div>
  );
}

export default App;
