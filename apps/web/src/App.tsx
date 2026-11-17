import { Rail } from "./components/Rail";
import { ConversationList } from "./components/ConversationList";
import { ChatPane } from "./components/ChatPane";
import { MobileNav } from "./components/MobileNav";
import { useChatStore } from "@/store/useChatStore";

export function App() {
  const activeId = useChatStore((s) => s.activeId);

  // Phone layout (< md): a single pane at a time — the conversation list with a
  // bottom tab bar, or the open chat full-screen. Desktop (md+): the classic
  // three-column layout. The Rail hides on phones in favour of MobileNav.
  return (
    <div className="flex h-[100dvh] w-screen overflow-hidden bg-[var(--color-base)] text-[var(--color-ink)] antialiased">
      <Rail />
      <div className="flex min-w-0 flex-1 flex-col md:flex-row">
        <div className="flex min-w-0 flex-1 overflow-hidden">
          <ConversationList />
          <ChatPane />
        </div>
        {!activeId && <MobileNav />}
      </div>
    </div>
  );
}
