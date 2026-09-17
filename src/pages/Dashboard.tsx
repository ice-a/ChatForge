import { useCallback, useEffect, useMemo, useState } from 'react';
import { App as AntApp, Button, Card, Col, Empty, Row, Select, Space, Statistic, Table, Tag, Typography } from 'antd';
import { DownloadOutlined, SyncOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import EChart from '../components/EChart';
import { useAppStore } from '../store';
import {
  getDailyTrend,
  getHourDistribution,
  getModelUsage,
  getToolSummary,
  getTotalCount,
  getTopProjects,
  initDb,
  type ModelUsage,
} from '../lib/db';
import { runScan } from '../lib/scan';
import { usageToCsv, exportText } from '../lib/export';
import dayjs from 'dayjs';

const TOOL_COLORS = ['#4f46e5', '#0891b2', '#059669', '#d97706', '#dc2626', '#7c3aed', '#db2777', '#2563eb', '#4d7c0f', '#6b7280'];

export default function Dashboard({ onGoSettings }: { onGoSettings: () => void }) {
  const { message } = AntApp.useApp();
  const { homeDir, dataVersion, lastScanAt, setScanResult } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [total, setTotal] = useState(0);
  const [toolSummary, setToolSummary] = useState<Awaited<ReturnType<typeof getToolSummary>>>([]);
  const [modelUsage, setModelUsage] = useState<ModelUsage[]>([]);
  const [daily, setDaily] = useState<Awaited<ReturnType<typeof getDailyTrend>>>([]);
  const [hours, setHours] = useState<Awaited<ReturnType<typeof getHourDistribution>>>([]);
  const [projects, setProjects] = useState<Awaited<ReturnType<typeof getTopProjects>>>([]);
  const [toolFilter, setToolFilter] = useState<string>('all');

  const load = useCallback(async () => {
    if (!homeDir) return;
    setLoading(true);
    try {
      const db = await initDb(homeDir);
      const [t, tools, models, d, h, p] = await Promise.all([
        getTotalCount(db),
        getToolSummary(db),
        getModelUsage(db),
        getDailyTrend(db, 30),
        getHourDistribution(db),
        getTopProjects(db, 10),
      ]);
      setTotal(t);
      setToolSummary(tools);
      setModelUsage(models);
      setDaily(d);
      setHours(h);
      setProjects(p);
    } catch (e) {
      message.error(`加载统计失败：${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [homeDir, message]);

  useEffect(() => {
    void load();
  }, [load, dataVersion]);

  const filteredUsage = useMemo(
    () => (toolFilter === 'all' ? modelUsage : modelUsage.filter((m) => m.tool === toolFilter)),
    [modelUsage, toolFilter],
  );

  const totalSessions = toolSummary.reduce((a, t) => a + t.sessions, 0) || 1;
  const totalMsgs = toolSummary.reduce((a, t) => a + t.msgs, 0);
  const totalTokensIn = toolSummary.reduce((a, t) => a + Number(t.tokens_in ?? 0), 0);
  const totalTokensOut = toolSummary.reduce((a, t) => a + Number(t.tokens_out ?? 0), 0);
  const modelCount = new Set(modelUsage.map((m) => m.model)).size;

  const pieOption = useMemo(
    () => ({
      tooltip: { trigger: 'item' },
      legend: { orient: 'vertical', right: 8, top: 'center', type: 'scroll' as const },
      series: [
        {
          name: '工具会话占比',
          type: 'pie',
          radius: ['40%', '70%'],
          center: ['38%', '50%'],
          itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
          label: { show: false },
          data: toolSummary.map((t, i) => ({
            name: t.tool,
            value: t.sessions,
            itemStyle: { color: TOOL_COLORS[i % TOOL_COLORS.length] },
          })),
        },
      ],
    }),
    [toolSummary],
  );

  const modelBarOption = useMemo(() => {
    const top = [...modelUsage].sort((a, b) => b.sessions - a.sessions).slice(0, 10);
    return {
      tooltip: { trigger: 'axis' },
      grid: { left: 8, right: 16, top: 32, bottom: 8, containLabel: true },
      xAxis: { type: 'category', data: top.map((m) => `${m.tool}·${m.model}`), axisLabel: { rotate: 24, fontSize: 10 } },
      yAxis: { type: 'value' },
      series: [
        { name: '会话数', type: 'bar', data: top.map((m) => m.sessions), itemStyle: { color: '#4f46e5', borderRadius: [4, 4, 0, 0] }, barMaxWidth: 28 },
        { name: '消息数', type: 'bar', data: top.map((m) => m.msgs), itemStyle: { color: '#94a3b8', borderRadius: [4, 4, 0, 0] }, barMaxWidth: 28 },
      ],
    };
  }, [modelUsage]);

  const trendOption = useMemo(
    () => ({
      tooltip: { trigger: 'axis' },
      grid: { left: 8, right: 16, top: 32, bottom: 8, containLabel: true },
      xAxis: { type: 'category', data: daily.map((d) => d.day) },
      yAxis: { type: 'value', minInterval: 1 },
      series: [
        {
          name: '会话数',
          type: 'line',
          smooth: true,
          data: daily.map((d) => d.sessions),
          areaStyle: { opacity: 0.15 },
          itemStyle: { color: '#0891b2' },
        },
      ],
    }),
    [daily],
  );

  const hourOption = useMemo(() => {
    const map = new Map(hours.map((h) => [String(h.hour), Number(h.sessions)]));
    return {
      tooltip: { trigger: 'axis' },
      grid: { left: 8, right: 16, top: 32, bottom: 8, containLabel: true },
      xAxis: { type: 'category', data: Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')) },
      yAxis: { type: 'value', minInterval: 1 },
      series: [
        {
          name: '会话数',
          type: 'bar',
          data: Array.from({ length: 24 }, (_, i) => map.get(String(i).padStart(2, '0')) ?? 0),
          itemStyle: { color: '#7c3aed', borderRadius: [4, 4, 0, 0] },
          barMaxWidth: 16,
        },
      ],
    };
  }, [hours]);

  const columns: ColumnsType<ModelUsage> = [
    { title: '工具', dataIndex: 'tool', key: 'tool', width: 100, filters: [...new Set(modelUsage.map((m) => m.tool))].map((t) => ({ text: t, value: t })), onFilter: (v, r) => r.tool === v },
    { title: '模型', dataIndex: 'model', key: 'model', ellipsis: true, render: (v: string) => <Tag>{v}</Tag> },
    { title: '会话数', dataIndex: 'sessions', key: 'sessions', sorter: (a, b) => a.sessions - b.sessions, defaultSortOrder: 'descend', width: 90, render: (v: number) => v.toLocaleString() },
    { title: '消息数', dataIndex: 'msgs', key: 'msgs', sorter: (a, b) => a.msgs - b.msgs, width: 90, render: (v: number) => v.toLocaleString() },
    { title: '输入 Token', dataIndex: 'tokens_in', key: 'tokens_in', sorter: (a, b) => a.tokens_in - b.tokens_in, width: 110, render: (v: number) => (v > 0 ? v.toLocaleString() : '—') },
    { title: '输出 Token', dataIndex: 'tokens_out', key: 'tokens_out', sorter: (a, b) => a.tokens_out - b.tokens_out, width: 110, render: (v: number) => (v > 0 ? v.toLocaleString() : '—') },
    {
      title: '会话占比',
      key: 'pct',
      width: 110,
      render: (_: unknown, r: ModelUsage) => `${((r.sessions / totalSessions) * 100).toFixed(1)}%`,
      sorter: (a, b) => a.sessions - b.sessions,
    },
    { title: '最近活跃', dataIndex: 'last_active', key: 'last_active', width: 150, sorter: (a, b) => a.last_active - b.last_active, render: (v: number) => dayjs(v).format('YYYY-MM-DD HH:mm') },
  ];

  const rescan = async () => {
    setScanning(true);
    try {
      const report = await runScan(homeDir, {});
      await setScanResult(Date.now(), report);
      message.success(`重新扫描完成：${report.reduce((a, r) => a + r.sessions, 0)} 个会话`);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setScanning(false);
    }
  };

  const doExportCsv = async () => {
    const path = await exportText(homeDir, `用量统计-${dayjs().format('YYYYMMDD-HHmmss')}.csv`, usageToCsv(filteredUsage));
    message.success(`已导出：${path}`);
  };

  if (!loading && total === 0) {
    return (
      <Empty description="还没有会话数据" style={{ marginTop: 80 }}>
        <Space>
          <Button type="primary" icon={<SyncOutlined />} loading={scanning} onClick={rescan}>
            立即扫描
          </Button>
          <Button onClick={onGoSettings}>配置会话来源</Button>
        </Space>
      </Empty>
    );
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Row gutter={[12, 12]}>
        <Col xs={12} md={4}><Card size="small"><Statistic title="会话总数" value={total} loading={loading} /></Card></Col>
        <Col xs={12} md={4}><Card size="small"><Statistic title="消息总数" value={totalMsgs} loading={loading} /></Card></Col>
        <Col xs={12} md={4}><Card size="small"><Statistic title="工具数" value={toolSummary.length} loading={loading} /></Card></Col>
        <Col xs={12} md={4}><Card size="small"><Statistic title="模型数" value={modelCount} loading={loading} /></Card></Col>
        <Col xs={12} md={4}><Card size="small"><Statistic title="输入 Token" value={totalTokensIn} loading={loading} /></Card></Col>
        <Col xs={12} md={4}><Card size="small"><Statistic title="输出 Token" value={totalTokensOut} loading={loading} /></Card></Col>
      </Row>

      <Row gutter={[12, 12]}>
        <Col xs={24} md={10}>
          <Card size="small" title="工具会话占比">
            <EChart option={pieOption} height={260} />
          </Card>
        </Col>
        <Col xs={24} md={14}>
          <Card size="small" title="模型用量 TOP10">
            <EChart option={modelBarOption} height={260} />
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card size="small" title="近 30 天会话趋势">
            <EChart option={trendOption} height={240} />
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card size="small" title="24 小时活跃分布">
            <EChart option={hourOption} height={240} />
          </Card>
        </Col>
      </Row>

      <Card
        size="small"
        title="工具 × 模型用量明细"
        extra={
          <Space>
            <Select
              size="small"
              value={toolFilter}
              onChange={setToolFilter}
              style={{ width: 140 }}
              options={[{ value: 'all', label: '全部工具' }, ...toolSummary.map((t) => ({ value: t.tool, label: t.tool }))]}
            />
            <Button size="small" icon={<DownloadOutlined />} onClick={doExportCsv}>
              导出 CSV
            </Button>
          </Space>
        }
      >
        <Table<ModelUsage>
          size="small"
          rowKey={(r) => `${r.tool}::${r.model}`}
          columns={columns}
          dataSource={filteredUsage}
          loading={loading}
          pagination={{ pageSize: 10, showSizeChanger: false }}
        />
      </Card>

      <Card size="small" title="项目 TOP10">
        <Table
          size="small"
          rowKey={(r) => r.project}
          dataSource={projects}
          loading={loading}
          pagination={false}
          columns={[
            { title: '项目', dataIndex: 'project', key: 'project', ellipsis: true },
            { title: '会话数', dataIndex: 'sessions', key: 'sessions', width: 100, render: (v: number) => v.toLocaleString() },
            { title: '消息数', dataIndex: 'msgs', key: 'msgs', width: 100, render: (v: number) => v.toLocaleString() },
          ]}
        />
      </Card>

      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        Token 用量目前仅有部分工具提供（如 ZCode）；其余工具以会话/消息数统计。 {lastScanAt > 0 && `数据截至 ${dayjs(lastScanAt).format('YYYY-MM-DD HH:mm')} 扫描。`}
      </Typography.Text>
    </Space>
  );
}
