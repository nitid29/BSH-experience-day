import Link from "next/link";

export default function NotFound() {
  return (
    <div className="shell" style={{ gridTemplateColumns: "1fr" }}>
      <main className="panel">
        <h1>Page not found</h1>
        <p className="lede">
          <Link href="/" className="link-btn">
            Go to the registration page
          </Link>
        </p>
      </main>
    </div>
  );
}
