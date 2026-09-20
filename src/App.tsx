import { useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Layout,
  List,
  Menu,
  Modal,
  Space,
  Tag,
  Typography,
  theme,
} from 'antd';
import {
  ApartmentOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
  ReloadOutlined,
  SettingOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { App as AntApp } from 'antd';
import Dashboard from './pages/Dashboard';
import Sessions from './pages/Sessions';
import Profile from './pages/Profile';
import Distill from './pages/Distill';
import Settings from './pages/Settings';
import { useAppStore } from './store';
import { useI18n } from './i18n';
import { runScan } from './lib/scan';
import dayjs from 'dayjs';

type PageKey = 'dashboard' | 'sessions' | 'profile' | 'distill' | 'settings';

export default function App() {
  const { message } = AntApp.useApp();
  const { token } = theme.useToken();
  const [page, setPage] = useState<PageKey>('dashboard');
  const [collapsed, setCollapsed] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState('');
  const { homeDir, bridgeMode, bridgeVersion, initDone, initError, initData, lastScanAt, lastScanReport, setScanResult, theme: themeMode, setTheme, lang, setLang } =
    useAppStore();
  const { t } = useI18n();

  useEffect(() => {
    void initData();
  }, [initData]);

  // 后台自动增量扫描：距上次扫描超过 4 小时（或从未扫描）时静默执行一次，每会话仅触发一次
  useEffect(() => {
    if (!initDone || !homeDir || initError) return;
    if (sessionStorage.getItem('chatforge.autoscanned')) return;
    const stale = lastScanAt === 0 || Date.now() - lastScanAt > 4 * 3600_000;
    if (!stale) return;
    sessionStorage.setItem('chatforge.autoscanned', '1');
    void (async () => {
      try {
        const report = await runScan(homeDir, {});
        await setScanResult(Date.now(), report);
      } catch {
        /* 静默失败，用户可手动扫描 */
      }
    })();
  }, [initDone, homeDir, initError, lastScanAt, setScanResult]);

  const startScan = async () => {
    if (!homeDir) return;
    setScanning(true);
    setScanProgress(t('app.scanPreparing'));
    try {
      const report = await runScan(homeDir, {}, (p) =>
        setScanProgress(t('app.scanning', { index: p.index, total: p.total, current: p.current })),
      );
      await setScanResult(Date.now(), report);
      const total = report.reduce((a, r) => a + r.sessions, 0);
      const failed = report.filter((r) => !r.ok);
      if (failed.length) message.warning(t('app.scanDoneWarn', { n: total, f: failed.length }));
      else message.success(t('app.scanDone', { n: total }));
      setReportOpen(true);
    } catch (e) {
      message.error(t('app.scanFail', { msg: (e as Error).message }));
    } finally {
      setScanning(false);
    }
  };

  const [reportOpen, setReportOpen] = useState(false);

  const menuItems = [
    { key: 'dashboard', icon: <DashboardOutlined />, label: t('menu.dashboard') },
    { key: 'sessions', icon: <DatabaseOutlined />, label: t('menu.sessions') },
    { key: 'profile', icon: <UserOutlined />, label: t('menu.profile') },
    { key: 'distill', icon: <ExperimentOutlined />, label: t('menu.distill') },
    { key: 'settings', icon: <SettingOutlined />, label: t('menu.settings') },
  ];

  const renderPage = () => {
    if (!initDone) return <Typography.Text type="secondary">{t('app.init')}</Typography.Text>;
    if (initError)
      return (
        <Alert
          type="error"
          showIcon
          message={t('app.bridgeErr')}
          description={
            <div>
              <p>{initError}</p>
              <p>{t('app.bridgeHintPrefix')}<code>pnpm dev:bridge</code>{t('app.bridgeHintSuffix')}</p>
            </div>
          }
        />
      );
    switch (page) {
      case 'dashboard':
        return <Dashboard onGoSettings={() => setPage('settings')} />;
      case 'sessions':
        return <Sessions />;
      case 'profile':
        return <Profile />;
      case 'distill':
        return <Distill />;
      case 'settings':
        return <Settings />;
    }
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Sider collapsible collapsed={collapsed} onCollapse={setCollapsed} theme="dark">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '16px 16px 8px' }}>
          <ApartmentOutlined style={{ color: '#818cf8', fontSize: 22 }} />
          {!collapsed && (
            <div>
              <div style={{ color: '#fff', fontWeight: 700, lineHeight: 1.2 }}>ChatForge</div>
              <div style={{ color: 'rgba(255,255,255,.45)', fontSize: 12 }}>{t('app.tagline')}</div>
            </div>
          )}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[page]}
          items={menuItems}
          onClick={(e) => setPage(e.key as PageKey)}
        />
      </Layout.Sider>
      <Layout>
        <Layout.Header
          style={{
            background: token.colorBgContainer,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingInline: 24,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          <Space size="middle">
            <Typography.Title level={4} style={{ margin: 0 }}>
              {menuItems.find((m) => m.key === page)?.label}
            </Typography.Title>
            <Badge
              status={bridgeMode === 'offline' ? 'error' : 'success'}
              text={
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {bridgeMode === 'tauri' ? t('bridge.tauri') : bridgeMode === 'node' ? t('bridge.node') : t('bridge.offline')} {bridgeVersion}
                </Typography.Text>
              }
            />
          </Space>
          <Space>
            <Button size="small" onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}>
              {lang === 'zh' ? 'EN' : '中文'}
            </Button>
            <Button
              icon={<span style={{ fontSize: 14 }}>{themeMode === 'dark' ? '🌙' : '☀️'}</span>}
              onClick={() => setTheme(themeMode === 'dark' ? 'light' : 'dark')}
            >
              {themeMode === 'dark' ? t('common.dark') : t('common.light')}
            </Button>
            {lastScanAt > 0 && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t('common.lastScan')}：{dayjs(lastScanAt).format('MM-DD HH:mm')}
                {lastScanReport.length ? ` · ${lastScanReport.reduce((a, r) => a + r.sessions, 0)} ${t('common.sessions')}` : ''}
              </Typography.Text>
            )}
            <Button type="primary" icon={<ReloadOutlined />} loading={scanning} onClick={startScan} disabled={!homeDir}>
              {t('common.scanAll')}
            </Button>
          </Space>
        </Layout.Header>
        <Layout.Content style={{ padding: 20, overflow: 'auto' }}>
          <div style={{ maxWidth: 1280, margin: '0 auto' }}>{renderPage()}</div>
        </Layout.Content>
      </Layout>

      <Modal
        title={t('scan.progress')}
        open={scanning}
        footer={null}
        closable={false}
        maskClosable={false}
      >
        <Typography.Text>{scanProgress}</Typography.Text>
      </Modal>

      <Modal title={t('scan.report')} open={reportOpen} onCancel={() => setReportOpen(false)} footer={null} width={640}>
        <List
          size="small"
          dataSource={lastScanReport}
          renderItem={(item) => (
            <List.Item>
              <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', gap: 12 }}>
                <Space>
                  <Badge status={item.ok ? (item.sessions > 0 ? 'success' : 'default') : 'error'} />
                  <Typography.Text strong>{item.label}</Typography.Text>
                </Space>
                <Typography.Text type="secondary">
                  {item.sessions > 0 ? `${t('scan.sessionCount', { n: item.sessions })} · ` : ''}
                  {item.message} · {(item.durationMs / 1000).toFixed(1)}s
                </Typography.Text>
              </div>
            </List.Item>
          )}
        />
      </Modal>
    </Layout>
  );
}
