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
import { generateRuleProfile } from '../lib/profile';
import { usageToCsv, exportText } from '../lib/export';
import { estimateCost, loadPrices } from '../lib/prices';
import { useI18n } from '../i18n';
import dayjs from 'dayjs';

const TOOL_COLORS = ['#4f46e5', '#0891b2', '#059669', '#d97706', '#dc2626', '#7c3aed', '#db2777', '#2563eb', '#4d7c0f', '#6b7280'];

export default function Dashboard({ onGoSettings }: { onGoSettings: () => void }) {
  const { message } = AntApp.useApp();
  const { t } = useI18n();
  const { homeDir, dataVersion, lastScanAt, setScanResult } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [total, setTotal] = useState(0);
  const [toolSummary, setToolSummary] = useState<Awaited<ReturnType<typeof getToolSummary>>>([]);
  const [modelUsage, setModelUsage] = useState<ModelUsage[]>([]);
  const [daily, setDaily] = useState<Awaited<ReturnType<typeof getDailyTrend>>>([]);
  const [hours, setHours] = useState<Awaited<ReturnType<typeof getHourDistribution>>>([]);
  const [projects, setProjects] = useState<Awaited<ReturnType<typeof getTopProjects>>>([]);
  const [prices, setPrices] = useState<Awaited<ReturnType<typeof loadPrices>>>([]);
  const [toolFilter, setToolFilter] = useState<string>('all');

  const load = useCallback(async () => {
    if (!homeDir) return;
    setLoading(true);
    try {
      const db = await initDb(homeDir);
      const [t, tools, models, d, h, p, prices] = await Promise.all([
        getTotalCount(db),
        getToolSummary(db),
        getModelUsage(db),
        getDailyTrend(db, 30),
        getHourDistribution(db),
        getTopProjects(db, 10),
        loadPrices(homeDir),
      ]);
      setTotal(t);
      setToolSummary(tools);
      setModelUsage(models);
      setDaily(d);
      setHours(h);
      setProjects(p);
      setPrices(prices);
    } catch (e) {
      message.error(t('dash.loadFail', { msg: (e as Error).message }));
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
  const costOf = (m: ModelUsage) => estimateCost(m.model, Number(m.tokens_in ?? 0), Number(m.tokens_out ?? 0), prices);
  const totalCost = modelUsage.reduce<number>((a, m) => a + (costOf(m) ?? 0), 0);
  const hasAnyCost = modelUsage.some((m) => costOf(m) !== null);
  const costByTool = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of modelUsage) {
      const c = costOf(m);
      if (c) map.set(m.tool, (map.get(m.tool) ?? 0) + c);
    }
    return [...map.entries()].map(([tool, cost]) => ({ tool, cost })).sort((a, b) => b.cost - a.cost);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelUsage, prices]);

  const pieOption = useMemo(
    () => ({
      tooltip: { trigger: 'item' },
      legend: { orient: 'vertical', right: 8, top: 'center', type: 'scroll' as const },
      series: [
        {
          name: t('dash.pieName'),
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
        { name: t('dash.barSessions'), type: 'bar', data: top.map((m) => m.sessions), itemStyle: { color: '#4f46e5', borderRadius: [4, 4, 0, 0] }, barMaxWidth: 28 },
        { name: t('dash.barMsgs'), type: 'bar', data: top.map((m) => m.msgs), itemStyle: { color: '#94a3b8', borderRadius: [4, 4, 0, 0] }, barMaxWidth: 28 },
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
          name: t('dash.barSessions'),
          type: 'bar',
          data: Array.from({ length: 24 }, (_, i) => map.get(String(i).padStart(2, '0')) ?? 0),
          itemStyle: { color: '#7c3aed', borderRadius: [4, 4, 0, 0] },
          barMaxWidth: 16,
        },
      ],
    };
  }, [hours]);

  const columns: ColumnsType<ModelUsage> = [
    { title: t('dash.col.tool'), dataIndex: 'tool', key: 'tool', width: 100, filters: [...new Set(modelUsage.map((m) => m.tool))].map((tt) => ({ text: tt, value: tt })), onFilter: (v, r) => r.tool === v },
    { title: t('dash.col.model'), dataIndex: 'model', key: 'model', ellipsis: true, render: (v: string) => <Tag>{v}</Tag> },
    { title: t('dash.col.sessions'), dataIndex: 'sessions', key: 'sessions', sorter: (a, b) => a.sessions - b.sessions, defaultSortOrder: 'descend', width: 90, render: (v: number) => v.toLocaleString() },
    { title: t('dash.col.msgs'), dataIndex: 'msgs', key: 'msgs', sorter: (a, b) => a.msgs - b.msgs, width: 90, render: (v: number) => v.toLocaleString() },
    { title: t('dash.tokensIn'), dataIndex: 'tokens_in', key: 'tokens_in', sorter: (a, b) => a.tokens_in - b.tokens_in, width: 110, render: (v: number) => (v > 0 ? v.toLocaleString() : '—') },
    { title: t('dash.tokensOut'), dataIndex: 'tokens_out', key: 'tokens_out', sorter: (a, b) => a.tokens_out - b.tokens_out, width: 110, render: (v: number) => (v > 0 ? v.toLocaleString() : '—') },
    {
      title: t('dash.estCost'),
      key: 'cost',
      width: 100,
      render: (_: unknown, r: ModelUsage) => {
        const c = costOf(r);
        return c !== null ? <span>${c < 0.01 ? c.toFixed(4) : c.toFixed(2)}</span> : <Typography.Text type="secondary">—</Typography.Text>;
      },
      sorter: (a, b) => (costOf(a) ?? 0) - (costOf(b) ?? 0),
    },
    {
      title: t('dash.col.share'),
      key: 'pct',
      width: 110,
      render: (_: unknown, r: ModelUsage) => `${((r.sessions / totalSessions) * 100).toFixed(1)}%`,
      sorter: (a, b) => a.sessions - b.sessions,
    },
    { title: t('dash.col.lastActive'), dataIndex: 'last_active', key: 'last_active', width: 150, sorter: (a, b) => a.last_active - b.last_active, render: (v: number) => dayjs(v).format('YYYY-MM-DD HH:mm') },
  ];

  const rescan = async () => {
    setScanning(true);
    try {
      const report = await runScan(homeDir, {});
      await setScanResult(Date.now(), report);
      message.success(t('dash.rescanDone', { n: report.reduce((a, r) => a + r.sessions, 0) }));
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setScanning(false);
    }
  };

  const scanAndProfile = async () => {
    setScanning(true);
    try {
      const report = await runScan(homeDir, {});
      await setScanResult(Date.now(), report);
      const total = report.reduce((a, r) => a + r.sessions, 0);
      await generateRuleProfile(homeDir);
      message.success(t('dash.scanProfileDone', { n: total }));
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setScanning(false);
    }
  };

  const doExportCsv = async () => {
    const path = await exportText(homeDir, `用量统计-${dayjs().format('YYYYMMDD-HHmmss')}.csv`, usageToCsv(filteredUsage, prices));
    message.success(t('dash.exportDone', { path }));
  };

  if (!loading && total === 0) {
    return (
      <Empty description={t('dash.empty.title')} style={{ marginTop: 80 }}>
        <Space direction="vertical" size="middle">
          <Space>
            <Button type="primary" icon={<SyncOutlined />} loading={scanning} onClick={scanAndProfile}>
              {t('dash.empty.cta')}
            </Button>
            <Button onClick={onGoSettings}>{t('dash.empty.config')}</Button>
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('dash.empty.note')}
          </Typography.Text>
        </Space>
      </Empty>
    );
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Row gutter={[12, 12]}>
        <Col xs={12} md={4}><Card size="small"><Statistic title={t('dash.totalSessions')} value={total} loading={loading} /></Card></Col>
        <Col xs={12} md={4}><Card size="small"><Statistic title={t('dash.totalMsgs')} value={totalMsgs} loading={loading} /></Card></Col>
        <Col xs={12} md={4}><Card size="small"><Statistic title={t('dash.toolCount')} value={toolSummary.length} loading={loading} /></Card></Col>
        <Col xs={12} md={4}><Card size="small"><Statistic title={t('dash.modelCount')} value={modelCount} loading={loading} /></Card></Col>
        <Col xs={12} md={4}><Card size="small"><Statistic title={t('dash.tokensIn')} value={totalTokensIn} loading={loading} /></Card></Col>
        <Col xs={12} md={4}><Card size="small"><Statistic title={t('dash.tokensOut')} value={totalTokensOut} loading={loading} /></Card></Col>
        {hasAnyCost && (
          <Col xs={12} md={4}>
            <Card size="small">
              <Statistic title={t('dash.estCost')} value={totalCost} precision={totalCost < 1 ? 4 : 2} prefix="$" loading={loading} />
            </Card>
          </Col>
        )}
      </Row>

      <Row gutter={[12, 12]}>
        <Col xs={24} md={10}>
          <Card size="small" title={t('dash.toolShare')}>
            <EChart option={pieOption} height={260} />
          </Card>
        </Col>
        <Col xs={24} md={14}>
          <Card size="small" title={t('dash.modelTop')}>
            <EChart option={modelBarOption} height={260} />
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card size="small" title={t('dash.trend30')}>
            <EChart option={trendOption} height={240} />
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card size="small" title={t('dash.hours24')}>
            <EChart option={hourOption} height={240} />
          </Card>
        </Col>
        {hasAnyCost && costByTool.length > 0 && (
          <Col xs={24} md={12}>
            <Card size="small" title={t('dash.costByTool')}>
              <EChart
                option={{
                  tooltip: { trigger: 'item', valueFormatter: (v: number) => `$${v.toFixed(4)}` },
                  legend: { orient: 'vertical', right: 8, top: 'center', type: 'scroll' as const },
                  series: [
                    {
                      name: t('dash.estCost'),
                      type: 'pie',
                      radius: ['40%', '70%'],
                      center: ['38%', '50%'],
                      itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
                      label: { show: false },
                      data: costByTool.map((c, i) => ({ name: c.tool, value: c.cost, itemStyle: { color: TOOL_COLORS[i % TOOL_COLORS.length] } })),
                    },
                  ],
                }}
                height={240}
              />
            </Card>
          </Col>
        )}
      </Row>

      <Card
        size="small"
        title={t('dash.usageTable')}
        extra={
          <Space>
            <Select
              size="small"
              value={toolFilter}
              onChange={setToolFilter}
              style={{ width: 140 }}
              options={[{ value: 'all', label: t('dash.allTools') }, ...toolSummary.map((t2) => ({ value: t2.tool, label: t2.tool }))]}
            />
            <Button size="small" icon={<DownloadOutlined />} onClick={doExportCsv}>
              {t('dash.exportCsv')}
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

      <Card size="small" title={t('dash.topProjects')}>
        <Table
          size="small"
          rowKey={(r) => r.project}
          dataSource={projects}
          loading={loading}
          pagination={false}
          columns={[
            { title: t('dash.col.project'), dataIndex: 'project', key: 'project', ellipsis: true },
            { title: t('dash.col.sessions'), dataIndex: 'sessions', key: 'sessions', width: 100, render: (v: number) => v.toLocaleString() },
            { title: t('dash.col.msgs'), dataIndex: 'msgs', key: 'msgs', width: 100, render: (v: number) => v.toLocaleString() },
          ]}
        />
      </Card>

      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t('dash.tokenNote')} {lastScanAt > 0 && t('dash.tokenNoteScan', { time: dayjs(lastScanAt).format('YYYY-MM-DD HH:mm') })}
      </Typography.Text>
    </Space>
  );
}
