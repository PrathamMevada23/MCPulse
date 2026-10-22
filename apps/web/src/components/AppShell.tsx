import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react';
import { ADMIN_KEY_REQUIRED_EVENT, getAdminKey, setAdminKey } from '../api';

type Theme = 'dark' | 'light';

const ThemeContext = createContext<{
  theme: Theme;
  toggleTheme: () => void;
}>({
  theme: 'dark',
  toggleTheme: () => undefined,
});

export const useTheme = () => useContext(ThemeContext);

export const AppShell = ({ children }: PropsWithChildren) => {
  const [theme, setTheme] = useState<Theme>(() => {
    return (localStorage.getItem('mcpulse-theme') as Theme) || 'dark';
  });
  const [adminKey, setAdminKeyValue] = useState<string>(() => getAdminKey());
  const [adminKeyOpen, setAdminKeyOpen] = useState(false);
  const [adminKeyDraft, setAdminKeyDraft] = useState<string>(() => getAdminKey());

  // The API asks for the key itself when a write operation is rejected, so
  // the editor opens automatically instead of showing a raw error.
  useEffect(() => {
    const open = () => {
      setAdminKeyDraft(getAdminKey());
      setAdminKeyOpen(true);
    };
    window.addEventListener(ADMIN_KEY_REQUIRED_EVENT, open);
    return () => window.removeEventListener(ADMIN_KEY_REQUIRED_EVENT, open);
  }, []);

  const applyAdminKey = () => {
    const value = adminKeyDraft.trim();
    setAdminKey(value);
    setAdminKeyValue(value);
    setAdminKeyOpen(false);
  };

  useEffect(() => {
    localStorage.setItem('mcpulse-theme', theme);
    const root = document.documentElement;
    if (theme === 'light') {
      root.classList.add('light-theme');
      root.classList.remove('dark');
    } else {
      root.classList.remove('light-theme');
      root.classList.add('dark');
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      <div
        className={`min-h-screen font-sans antialiased transition-colors duration-200 ${
          theme === 'light'
            ? 'bg-[#fafafa] text-zinc-900 selection:bg-zinc-200 selection:text-zinc-900'
            : 'bg-zinc-950 text-zinc-100 selection:bg-zinc-800 selection:text-zinc-100'
        }`}
      >
        {/* Top navigation */}
        <header
          className={`sticky top-0 z-40 border-b backdrop-blur-md transition-colors duration-200 ${
            theme === 'light'
              ? 'border-zinc-200 bg-[#fafafa]/80'
              : 'border-zinc-800/80 bg-zinc-950/80'
          }`}
        >
          <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
            <div className="flex items-center gap-3">
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-lg font-mono text-xs font-bold shadow-sm ${
                  theme === 'light'
                    ? 'bg-zinc-900 text-zinc-50'
                    : 'bg-zinc-100 text-zinc-950'
                }`}
              >
                M
              </div>
              <div className="flex items-center gap-2">
                <span className="font-semibold tracking-tight">MCPulse</span>
                <span className={theme === 'light' ? 'text-zinc-400' : 'text-zinc-600'}>/</span>
                <span className={`text-xs ${theme === 'light' ? 'text-zinc-500' : 'text-zinc-400'}`}>
                  Observability Platform
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Telemetry CSV Export button */}
              <a
                href="/api/reports/export-csv"
                download="mcpulse-telemetry-report.csv"
                className={`inline-flex h-8 items-center justify-center rounded-md border px-2.5 text-xs font-medium transition-colors ${
                  theme === 'light'
                    ? 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100 shadow-xs'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-white'
                }`}
                title="Download CSV telemetry report (FR-12)"
              >
                Export CSV
              </a>

              {/* Administrative key */}
              {adminKeyOpen ? (
                <div className="flex items-center gap-1.5">
                  <input
                    type="password"
                    value={adminKeyDraft}
                    autoFocus
                    placeholder="admin key"
                    aria-label="Administrative key"
                    onChange={(event) => setAdminKeyDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void applyAdminKey();
                      if (event.key === 'Escape') setAdminKeyOpen(false);
                    }}
                    className={`h-8 w-40 rounded-md border px-2 text-xs outline-none ${
                      theme === 'light'
                        ? 'border-zinc-200 bg-white text-zinc-800'
                        : 'border-zinc-800 bg-zinc-900 text-zinc-100'
                    }`}
                  />
                  <button
                    onClick={() => void applyAdminKey()}
                    className={`inline-flex h-8 items-center rounded-md border px-2.5 text-xs font-medium transition-colors ${
                      theme === 'light'
                        ? 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100'
                        : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
                    }`}
                  >
                    Save
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setAdminKeyDraft(adminKey);
                    setAdminKeyOpen(true);
                  }}
                  title="Administrative key for write operations (tool discovery, manual checks, adding or removing servers)"
                  className={`inline-flex h-8 items-center justify-center rounded-md border px-2.5 text-xs font-medium transition-colors ${
                    adminKey
                      ? theme === 'light'
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                        : 'border-emerald-900/60 bg-emerald-950/40 text-emerald-300'
                      : theme === 'light'
                        ? 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100'
                        : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
                  }`}
                >
                  {adminKey ? 'Admin key set' : 'Set admin key'}
                </button>
              )}

              {/* Theme toggle button */}
              <button
                onClick={toggleTheme}
                aria-label="Toggle off-white light theme"
                className={`inline-flex h-8 items-center justify-center rounded-md border px-2.5 text-xs font-medium transition-colors ${
                  theme === 'light'
                    ? 'border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-100 shadow-xs'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-white'
                }`}
              >
                {theme === 'light' ? 'Dark' : 'White'}
              </button>

              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${
                  theme === 'light'
                    ? 'border-zinc-200 bg-white text-zinc-600 shadow-xs'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-400'
                }`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Cloud Active
              </span>
            </div>
          </div>
        </header>

        {/* Main content container */}
        <main className="mx-auto max-w-7xl px-6 py-8">
          {children}
        </main>
      </div>
    </ThemeContext.Provider>
  );
};
