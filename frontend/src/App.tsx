import { StoreProvider, useStore } from './state/store';
import { MobileTabs, ToastHost, TopNav } from './components/Shell';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AskPage } from './pages/AskPage';
import { PlacesPage } from './pages/PlacesPage';
import { WatchesPage } from './pages/WatchesPage';
import { LibraryPage } from './pages/LibraryPage';
import { ModalHost } from './modals/ModalHost';

function Routes() {
  const { route } = useStore();
  return (
    <>
      <TopNav />
      {/* Ask stays mounted so the globe, map and chat keep their state across tabs. */}
      <ErrorBoundary label="ask">
        <AskPage active={route.page === 'ask'} />
      </ErrorBoundary>
      {/*
        One boundary per page, keyed on the route, so a crash on one screen does not take the
        nav with it and navigating away clears the error.
      */}
      <ErrorBoundary key={route.page} label={route.page}>
        {route.page === 'places' && <PlacesPage />}
        {route.page === 'triggers' && <WatchesPage />}
        {route.page === 'library' && <LibraryPage />}
      </ErrorBoundary>
      <MobileTabs />
      <ErrorBoundary label="modal">
        <ModalHost />
      </ErrorBoundary>
      <ToastHost />
    </>
  );
}

export function App() {
  return (
    <ErrorBoundary label="app">
      <StoreProvider>
        <Routes />
      </StoreProvider>
    </ErrorBoundary>
  );
}
