import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Link } from "react-router-dom";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-polymarket-border bg-polymarket-card/80 sticky top-0 z-10 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link to="/" className="text-lg font-semibold text-white">
            Event Perpetuals
          </Link>
          <nav className="flex items-center gap-6">
            <Link to="/" className="text-gray-400 hover:text-white">Markets</Link>
            <Link to="/create" className="text-gray-400 hover:text-white">Create</Link>
            <ConnectButton />
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
