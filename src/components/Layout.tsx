import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import logo from '../assets/theme/logo.png';
import { Panel } from './Panel';

/**
 * The 2010 shell: a spiral notebook lying on a floor strewn with trash, with
 * the possum's torn notebook square pinned over the top-left corner and the
 * navigation tabs poking out of the top edge. Everything is sized in
 * percentages so the whole arrangement survives being squeezed onto a phone.
 */
export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[740px] px-2 pt-10 pb-10 sm:pt-[75px]">
      <nav className="relative z-20 flex flex-wrap justify-end gap-1 pr-[7%] text-[12px]">
        <NavLink to="/" end className="tab">
          Quotes
        </NavLink>
        <NavLink to="/about/" className="tab">
          About
        </NavLink>
      </nav>

      <div className="relative">
        <Link
          to="/"
          className="absolute top-0 left-0 z-10 block w-[31%] max-w-[231px] min-w-[110px] -translate-y-[22%] no-underline"
          title="Back to the burrow"
        >
          <img src={logo} width={231} height={226} alt="Possum Tales" className="w-full" />
        </Link>

        <Panel variant="shell">
          {/* Clear the possum, which hangs down over the top-left corner. */}
          <div className="pt-[20%] pb-4 sm:pt-[17%]">{children}</div>
        </Panel>
      </div>

      <p className="mt-2 text-center text-[10px] leading-4 text-faint">
        <a
          href="https://martinezmedia.net"
          className="font-normal text-faint"
          target="_blank"
          rel="noreferrer noopener"
        >
          A Martinez Media site.
        </a>
      </p>
    </div>
  );
}
