import { useStore } from '../state/store';
import { ExportModal } from './ExportModal';
import { ConnectorsModal } from './ConnectorsModal';
import { LanguageModal } from './LanguageModal';
import { AddPlaceModal } from './AddPlaceModal';
import { WatchBuilderModal } from './WatchBuilderModal';
import { KnowledgeCardModal } from './KnowledgeCardModal';

export function ModalHost() {
  const { modal } = useStore();
  if (!modal) return null;
  switch (modal.kind) {
    case 'export': return <ExportModal target={modal.target} />;
    // "Ask an expert" was a paid marketplace with no backend; nothing opens it any more.
    case 'expert': return null;
    case 'connectors': return <ConnectorsModal focus={modal.focus} />;
    // There is no mobile app; the channels modal says honestly what is and isn't built.
    case 'app': return <ConnectorsModal focus="push" />;
    case 'lang': return <LanguageModal />;
    case 'addPlace': return <AddPlaceModal />;
    case 'watchBuilder': return <WatchBuilderModal prefill={modal.prefill} placeId={modal.placeId} skillId={modal.skillId} fromAnswer={modal.fromAnswer} />;
    case 'knowledgeCard': return <KnowledgeCardModal cardId={modal.cardId} />;
  }
}
