const shortcutTableData = [
  [
    { key: 'j/k', action: 'Down/Up in FlowList' },
    { key: 's', action: 'Focus search bar' },
    { key: 'esc', action: 'Unfocus search bar' },
    { key: 'i/o', action: 'Toggle flag in/out filters' },
  ],
  [
    { key: 'h/l', action: 'Up/Down in Flow' },
    { key: 'a', action: 'Last 5 ticks' },
    { key: 'c', action: 'Clear time selection' },
    { key: 'r', action: 'Refresh flows' },
  ],
  [
    { key: 'm', action: 'Switch between decoders' },
    { key: 'd', action: 'Diff view' },
    { key: 'f', action: 'Load flow to first diff slot' },
    { key: 'g', action: 'Load flow to second diff slot' },
  ]
];

const generateShortcutTable = (data: { key: string; action: string; }[][]) => {
  return (
        <div className="flex flex-row gap-4">
          {data.map((table, tableIndex) => (
            <table key={tableIndex} className="border-collapse border border-slate-500 dark:border-slate-400 table-auto">
              <thead>
                <tr>
                  <th className="border border-slate-600 dark:border-slate-400 px-4 text-gray-900 dark:text-gray-100">Key</th>
                  <th className="border border-slate-600 dark:border-slate-400 px-4 text-gray-900 dark:text-gray-100">Action</th>
                </tr>
              </thead>
              <tbody>
              {table.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {Object.entries(row).map((cell, cellIndex) => (
                    <td className="border border-slate-700 dark:border-slate-400 px-4 text-gray-900 dark:text-gray-100" key={cellIndex}>
                      {cell[1]}
                    </td>
                  ))}
                </tr>
              ))}
              </tbody>
            </table>
          ))}
        </div>
  );
};


export function Home() {
  return (
    <div className="p-4 flex flex-col gap-4 justify-center items-center h-full opacity-40">
      <span className="text-9xl">🥀</span>
      <h1 className="text-5xl text-gray-600 dark:text-gray-300">Welcome to Rose</h1>
      <h1 className="text-2xl text-gray-500 dark:text-gray-400">Shortcut reference:</h1>
      {generateShortcutTable(shortcutTableData)}
      {/* <h1 className="text-3xl font-bold pt-2 pb-4"></h1> */}
    </div>
  );
}
