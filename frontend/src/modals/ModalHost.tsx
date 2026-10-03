import { useStore } from '../state/store';
import { ExportModal } from './ExportModal';
import { ExpertModal } from './ExpertModal';
import { ConnectorsModal } from './ConnectorsModal';
import { MobileAppModal } from './MobileAppModal';
import { LanguageModal } from './LanguageModal';
import { AddPlaceModal } from './AddPlaceModal';
import { WatchBuilderModal } from './WatchBuilderModal';
import { KnowledgeCardModal } from './KnowledgeCardModal';

export function ModalHost() {
  const { modal } = useStore();
  if (!modal) return null;
  switch (modal.kind) {
    case 'export': return <ExportModal target={modal.target} />;
    case 'expert': return <ExpertModal context={modal.context} placeId={modal.placeId} />;
    case 'connectors': return <ConnectorsModal focus={modal.focus} />;
    case 'app': return <MobileAppModal />;
    case 'lang': return <LanguageModal />;
    case 'addPlace': return <AddPlaceModal prefill={modal.prefill} />;
    case 'watchBuilder': return <WatchBuilderModal prefill={modal.prefill} placeId={modal.placeId} skillId={modal.skillId} fromAnswer={modal.fromAnswer} dashboardId={modal.dashboardId} />;
    case 'knowledgeCard': return <KnowledgeCardModal cardId={modal.cardId} />;
  }
}
