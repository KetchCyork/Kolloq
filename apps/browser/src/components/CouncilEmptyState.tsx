import { useStore } from "../store";

export function CouncilEmptyState() {
  const { accounts, openAccountsManager, createCouncilSession } = useStore();

  function handleNewCouncil() {
    if (accounts.length < 2) {
      window.alert("A council needs at least 2 accounts, each on its own provider/model. Add another account first.");
      openAccountsManager();
      return;
    }
    createCouncilSession(accounts.slice(0, 2).map((account) => ({ accountId: account.id })));
  }

  return (
    <div className="main">
      <div className="chat-header">
        <span>Advisory Council</span>
      </div>
      <div className="empty-state" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <p>Bring multiple agents together to debate a question and reach a decision brief.</p>
        <button className="sidebar-new-btn" style={{ margin: 0 }} onClick={handleNewCouncil}>
          <span className="sidebar-new-btn-icon">+</span> New council
        </button>
      </div>
    </div>
  );
}
