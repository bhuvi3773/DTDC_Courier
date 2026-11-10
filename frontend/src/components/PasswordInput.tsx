'use client';

import { useState } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';

export function PasswordInput(props: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  minLength?: number;
  autoComplete?: string;
  id?: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative mt-1">
      <input
        id={props.id}
        type={visible ? 'text' : 'password'}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder ?? '••••••••'}
        required={props.required}
        minLength={props.minLength}
        autoComplete={props.autoComplete}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 pl-9 pr-10 text-sm text-slate-900 focus:border-brand-600 focus:outline-none"
      />
      <Lock className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        title={visible ? 'Hide password' : 'Show password'}
        className="absolute right-2.5 top-2 rounded p-0.5 text-slate-400 hover:text-slate-700 focus:outline-none"
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

