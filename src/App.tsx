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
  const { homeDir, bridgeMode, bridgeVersion, initDone, initError, initData, lastScanAt, lastScanReport, setScanResult } =
    useAppStore();

  useEffect(() => {
    void initData();
  }, [initData]);

  const startScan = async () => {
    if (!homeDir) return;
    setScanning(true);
    setScanProgress('准备扫描…');
    try {
      const report = await runScan(homeDir, {}, (p) =>
        setScanProgress(`(${p.index}/${p.total}) 正在扫描：${p.current}`),
      );
      await setScanResult(Date.now(), report);
      const total = report.reduce((a, r) => a + r.sessions, 0);
      const failed = report.filter((r) => !r.ok);
      if (failed.length) message.warning(`扫描完成：新入库 ${total} 个会话，${failed.length} 个来源失败`);
      else message.success(`扫描完成：共 ${total} 个会话入库`);
      setReportOpen(true);
    } catch (e) {
      message.error(`扫描失败：${(e as Error).message}`);
    } finally {
      setScanning(false);
    }
  };

  const [reportOpen, setReportOpen] = useState(false);

  const menuItems = [
    { key: 'dashboard', icon: <DashboardOutlined />, label: '仪表盘' },
    { key: 'sessions', icon: <DatabaseOutlined />, label: '会话库' },
    { key: 'profile', icon: <UserOutlined />, label: '用户画像' },
    { key: 'distill', icon: <ExperimentOutlined />, label: '蒸馏大师' },
    { key: 'settings', icon: <SettingOutlined />, label: '设置' },
  ];

  const renderPage = () => {
    if (!initDone) return <Typography.Text type="secondary">初始化中…</Typography.Text>;
    if (initError)
      return (
        <Alert
          type="error"
          showIcon
          message="无法连接本地桥接层"
          description={
            <div>
              <p>{initError}</p>
              <p>开发模式下请先运行：<code>pnpm dev:bridge</code>，再刷新页面。</p>
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
              <div style={{ color: 'rgba(255,255,255,.45)', fontSize: 12 }}>AI 会话锻造厂</div>
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
                  {bridgeMode === 'tauri' ? 'Tauri 桥接' : bridgeMode === 'node' ? 'Node 开发桥' : '离线'} {bridgeVersion}
                </Typography.Text>
              }
            />
          </Space>
          <Space>
            {lastScanAt > 0 && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                上次扫描：{dayjs(lastScanAt).format('MM-DD HH:mm')}
                {lastScanReport.length ? ` · ${lastScanReport.reduce((a, r) => a + r.sessions, 0)} 会话` : ''}
              </Typography.Text>
            )}
            <Button type="primary" icon={<ReloadOutlined />} loading={scanning} onClick={startScan} disabled={!homeDir}>
              扫描全部来源
            </Button>
          </Space>
        </Layout.Header>
        <Layout.Content style={{ padding: 20, overflow: 'auto' }}>
          <div style={{ maxWidth: 1280, margin: '0 auto' }}>{renderPage()}</div>
        </Layout.Content>
      </Layout>

      <Modal
        title="扫描进度"
        open={scanning}
        footer={null}
        closable={false}
        maskClosable={false}
      >
        <Typography.Text>{scanProgress}</Typography.Text>
      </Modal>

      <Modal title="扫描报告" open={reportOpen} onCancel={() => setReportOpen(false)} footer={null} width={640}>
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
                  {item.sessions > 0 ? `${item.sessions} 个会话 · ` : ''}
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
