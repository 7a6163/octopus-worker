import { ComponentChildren } from 'preact';

interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => ComponentChildren;
  class?: string;
}

interface TableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyFn: (row: T) => string | number;
  empty?: string;
}

export function Table<T>({ columns, data, keyFn, empty = 'No data' }: TableProps<T>) {
  return (
    <div class="overflow-x-auto rounded-lg border border-slate-700">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-slate-700 bg-slate-800/50">
            {columns.map((col) => (
              <th key={col.key} class={`px-4 py-3 text-left font-medium text-slate-400 ${col.class || ''}`}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} class="px-4 py-8 text-center text-slate-500">
                {empty}
              </td>
            </tr>
          ) : (
            data.map((row) => (
              <tr key={keyFn(row)} class="border-b border-slate-700/50 hover:bg-slate-800/30">
                {columns.map((col) => (
                  <td key={col.key} class={`px-4 py-3 text-slate-300 ${col.class || ''}`}>
                    {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
