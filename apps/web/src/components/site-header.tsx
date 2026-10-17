import Link from "next/link";
import { Radio } from "lucide-react";

export function SiteHeader() {
  return (
    <header className="site-header">
      <Link className="brand" href="/" aria-label="少数派红包首页">
        <span className="brand-mark" aria-hidden="true">
          <span />
        </span>
        <span>少数派红包</span>
      </Link>
      <div className="network-pill">
        <Radio size={14} aria-hidden="true" />
        Monad Testnet
      </div>
    </header>
  );
}
