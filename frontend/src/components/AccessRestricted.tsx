'use client';

import Link from 'next/link';
import { ShieldAlert, ArrowRight } from 'lucide-react';

export function AccessRestricted(props: {
  roleLabel: string;
  requiredLabel: string;
  fallbackHref: string;
}) {
  return (
    <div className="mx-auto max-w-lg px-4 py-16 text-center">
      <div className="rounded-2xl border border-amber-200 bg-white p-8 shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600">
          <ShieldAlert className="h-6 w-6" />
        </div>
        <h1 className="mt-4 text-xl font-bold text-slate-900">Access Restricted</h1>
        <p className="mt-2 text-xs leading-relaxed text-slate-600">
          You are signed in as <span className="font-semibold text-slate-800">{props.roleLabel}</span>.
          This workspace is restricted to{' '}
          <span className="font-semibold text-slate-800">{props.requiredLabel}</span>.
        </p>
        <div className="mt-6 flex justify-center">
          <Link
            href={props.fallbackHref}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-brand-700"
          >
            Go to Your Workspace <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}

