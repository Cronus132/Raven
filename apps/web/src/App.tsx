import { Rail } from "./components/Rail";
import { ConversationList } from "./components/ConversationList";
import { ChatPane } from "./components/ChatPane";

export function App() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--color-base)] text-[var(--color-ink)] antialiased">
      <Rail />
      <ConversationList />
      <ChatPane />
    </div>
  );
}
