import { StoreProvider, useStore } from './state/store';
import { MobileTabs, ToastHost, TopNav } from './components/Shell';
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
      <AskPage active={route.page === 'ask'} />
      {route.page === 'places' && <PlacesPage />}
      {route.page === 'watches' && <WatchesPage />}
      {route.page === 'library' && <LibraryPage />}
      <MobileTabs />
      <ModalHost />
      <ToastHost />
    </>
  );
}

export function App() {
  return (
    <StoreProvider>
      <Routes />
    </StoreProvider>
  );
}
