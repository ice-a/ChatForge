import React from 'react';
import ReactDOM from 'react-dom/client';
import { App as AntApp, ConfigProvider, theme as antdTheme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import App from './App';
import { useAppStore } from './store';
import { I18nContext, translate } from './i18n';
import { useMemo } from 'react';

function ThemedRoot() {
  const themeMode = useAppStore((s) => s.theme);
  const lang = useAppStore((s) => s.lang);
  const i18n = useMemo(() => ({ lang, t: (key: string, vars?: Record<string, string | number>) => translate(lang, key, vars) }), [lang]);
  return (
    <I18nContext.Provider value={i18n}>
      <ConfigProvider
        locale={lang === 'zh' ? zhCN : enUS}
        theme={{
          algorithm: themeMode === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
          token: {
            colorPrimary: '#4f46e5',
            borderRadius: 8,
          },
        }}
      >
        <AntApp>
          <App />
        </AntApp>
      </ConfigProvider>
    </I18nContext.Provider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemedRoot />
  </React.StrictMode>,
);
