export function ComingSoonView({ title, description }: { title: string; description: string }) {
  return (
    <div className="main">
      <div className="chat-header">
        <span>{title}</span>
      </div>
      <div className="no-session">{description}</div>
    </div>
  );
}
