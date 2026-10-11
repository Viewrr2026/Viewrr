import { useState, type InputHTMLAttributes } from "react";
import { Input } from "./input";
/** Format on blur, retaining the decimal draft and caret while editing. */
export function GbpInput({ value, onValueChange, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & { value: string; onValueChange: (value: string) => void }) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(value.replace(/[£,\s]/g, ""));
  const numeric = value.replace(/[£,\s]/g, "");
  const display = focused ? draft : numeric === "" || !Number.isFinite(Number(numeric)) ? numeric : Number(numeric).toFixed(2);
  return <div className="relative min-w-0">
    <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-sm" aria-hidden="true">£</span>
    <Input {...props} type="text" inputMode="decimal" value={display} className={`${props.className ?? ""} pl-7`}
      onFocus={e => { setDraft(numeric); setFocused(true); props.onFocus?.(e); }}
      onBlur={e => { setFocused(false); props.onBlur?.(e); }}
      onChange={e => { const next = e.target.value.replace(/[£,\s]/g, ""); if (/^\d*(\.\d{0,2})?$/.test(next)) { setDraft(next); onValueChange(next); } }} />
  </div>;
}
