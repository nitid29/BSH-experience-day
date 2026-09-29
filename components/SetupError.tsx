export default function SetupError({ error }: { error: unknown }) {
  console.error(error);
  const msg = error instanceof Error ? error.message : String(error);
  const setup = /not configured|not set/.test(msg);
  return (
    <div className="shell" style={{ gridTemplateColumns: "1fr" }}>
      <main className="panel" style={{ maxWidth: 640 }}>
        <h1>{setup ? "Setup incomplete" : "Registration is temporarily unavailable"}</h1>
        <p className="lede">
          {setup
            ? msg
            : "We couldn't reach the registration database. Please try again in a few minutes. If the problem persists, contact the organising team."}
        </p>
      </main>
    </div>
  );
}
