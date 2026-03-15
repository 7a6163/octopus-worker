import { JSX } from 'preact';

export type InputEvent = JSX.TargetedEvent<HTMLInputElement>;
export type SelectEvent = JSX.TargetedEvent<HTMLSelectElement>;

export function inputValue(e: InputEvent): string {
  return (e.target as HTMLInputElement).value;
}

export function selectValue(e: SelectEvent): string {
  return (e.target as HTMLSelectElement).value;
}
