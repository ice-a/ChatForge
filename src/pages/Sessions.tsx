import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  App as AntApp,
  Badge,
  Button,
  Card,
  Drawer,
  Empty,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { DeleteOutlined, EditOutlined, RedoOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useAppStore } from '../store';
import {
  getSessionDetail,
  getToolSummary,
  initDb,
  listSessions,
  resetEdit,
  resetSessionEdits,
  saveEdit,
  type SessionFilter,
  type ToolSummary,
} from '../lib/db';
import type { HubMessage, SessionRow } from '../types';
import dayjs from 'dayjs';

const ROLE_META: Record<string, { label: string; color: string }> = {
  user: { label: '用户', color: 'blue' },
  assistant: { label: '助手', color: 'green' },
  system: { label: '系统', color: 'orange' },
  tool: { label: '工具', color: 'default' },
};

export default function Sessions() {
  const { message, modal } = AntApp.useApp();
  const { homeDir, dataVersion } = useAppStore();
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [tools, setTools] = useState<ToolSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [tool, setTool] = useState('all');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ row: SessionRow; messages: HubMessage[] } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editing, setEditing] = useState<{ index: number; content: string } | null>(null);

  const load = useCallback(async () => {
    if (!homeDir) return;
    setLoading(true);
    try {
      const db = await initDb(homeDir);
      const filter: SessionFilter = { tool, search, limit: 2000 };
      const [r, t] = await Promise.all([listSessions(db, filter), getToolSummary(db)]);
      setRows(r);
      setTools(t);
    } catch (e) {
      message.error(`加载会话失败：${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [homeDir, tool, search, message]);

  useEffect(() => {
    void load();
  }, [load, dataVersion]);

  const openDetail = async (id: string) => {
    setOpenId(id);
    setDetailLoading(true);
    try {
      const db = await initDb(homeDir);
      setDetail(await getSessionDetail(db, id));
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setDetailLoading(false);
    }
  };

  const reloadDetail = async () => {
    if (openId) await openDetail(openId);
  };

  const saveTitle = async (newTitle: string) => {
    if (!detail) return;
    const db = await initDb(homeDir);
    await saveEdit(db, detail.row.id, -1, newTitle);
    message.success('标题已更新（覆盖层，原文件未改动）');
    await load();
    await reloadDetail();
  };

  const doSaveEdit = async () => {
    if (!detail || !editing) return;
    const db = await initDb(homeDir);
    await saveEdit(db, detail.row.id, editing.index, editing.content);
    message.success(`消息 #${editing.index} 已更新`);
    setEditing(null);
    await reloadDetail();
    await load();
  };

  const doResetEdit = async (index: number) => {
    if (!detail) return;
    const db = await initDb(homeDir);
    await resetEdit(db, detail.row.id, index);
    message.success('已还原为原始内容');
    await reloadDetail();
    await load();
  };

  const doResetAll = () => {
    if (!detail) return;
    modal.confirm({
      title: '还原此会话的全部修改？',
      content: '将删除该会话的所有编辑覆盖层，恢复为工具原始内容。',
      onOk: async () => {
        const db = await initDb(homeDir);
        await resetSessionEdits(db, detail.row.id);
        message.success('已全部还原');
        await reloadDetail();
        await load();
      },
    });
  };

  const columns: ColumnsType<SessionRow> = useMemo(
    () => [
      {
        title: '标题',
        dataIndex: 'title',
        key: 'title',
        ellipsis: { showTitle: false },
        render: (v: string, r: SessionRow) => (
          <Tooltip title={v}>
            <a onClick={() => void openDetail(r.id)}>{v}</a>
          </Tooltip>
        ),
      },
      { title: '工具', dataIndex: 'tool', key: 'tool', width: 100, render: (v: string) => <Tag color="geekblue">{v}</Tag> },
      { title: '项目', dataIndex: 'project', key: 'project', width: 140, ellipsis: true, render: (v: string | null) => v ?? '—' },
      { title: '模型', dataIndex: 'model', key: 'model', width: 150, ellipsis: true, render: (v: string | null) => (v ? <Tag>{v}</Tag> : '—') },
      { title: '消息', dataIndex: 'message_count', key: 'message_count', width: 70, sorter: (a, b) => a.message_count - b.message_count },
      {
        title: '更新时间',
        dataIndex: 'updated_at',
        key: 'updated_at',
        width: 140,
        sorter: (a, b) => a.updated_at - b.updated_at,
        defaultSortOrder: 'descend',
        render: (v: number) => dayjs(v).format('YYYY-MM-DD HH:mm'),
      },
      {
        title: '',
        key: 'edited',
        width: 60,
        render: (_: unknown, r: SessionRow) => (Number(r.edited) > 0 ? <Badge status="warning" text={<Typography.Text type="warning" style={{ fontSize: 12 }}>已编辑</Typography.Text>} /> : null),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows],
  );

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Card size="small">
        <Space wrap>
          <Select
            value={tool}
            onChange={(v) => setTool(v)}
            style={{ width: 150 }}
            options={[{ value: 'all', label: '全部工具' }, ...tools.map((t) => ({ value: t.tool, label: `${t.tool} (${t.sessions})` }))]}
          />
          <Input.Search
            placeholder="搜索标题 / 首条提问 / 项目"
            allowClear
            style={{ width: 320 }}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onSearch={(v) => setSearch(v)}
          />
          <Typography.Text type="secondary">{rows.length} 个会话</Typography.Text>
        </Space>
      </Card>

      <Table<SessionRow>
        size="small"
        rowKey="id"
        columns={columns}
        dataSource={rows}
        loading={loading}
        pagination={{ pageSize: 20, showSizeChanger: false }}
      />

      <Drawer
        width={Math.min(780, typeof window !== 'undefined' ? window.innerWidth - 60 : 780)}
        open={!!openId}
        onClose={() => setOpenId(null)}
        title={
          detail ? (
            <Space.Compact style={{ width: '100%' }}>
              <Input
                defaultValue={detail.row.title}
                key={detail.row.id + detail.row.title}
                onPressEnter={(e) => void saveTitle((e.target as HTMLInputElement).value)}
                onBlur={(e) => {
                  if (e.target.value !== detail.row.title) void saveTitle(e.target.value);
                }}
              />
            </Space.Compact>
          ) : (
            '会话详情'
          )
        }
        extra={
          detail && Number(detail.row.edited) > 0 ? (
            <Button size="small" icon={<RedoOutlined />} onClick={doResetAll}>
              还原全部修改
            </Button>
          ) : null
        }
        styles={{ body: { padding: 16 } }}
      >
        {detailLoading || !detail ? (
          <Typography.Text type="secondary">加载中…</Typography.Text>
        ) : (
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            <Space wrap size="small">
              <Tag color="geekblue">{detail.row.tool}</Tag>
              {detail.row.model && <Tag>{detail.row.model}</Tag>}
              {detail.row.project && <Tag color="purple">{detail.row.project}</Tag>}
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {detail.messages.length} 条消息 · 更新于 {dayjs(detail.row.updated_at).format('YYYY-MM-DD HH:mm')}
              </Typography.Text>
            </Space>
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }} copyable={{ text: detail.row.source_path }}>
              来源：{detail.row.source_path}
            </Typography.Paragraph>

            {detail.messages.map((m, i) => {
              const meta = ROLE_META[m.role] ?? { label: m.role, color: 'default' };
              return (
                <Card
                  key={i}
                  size="small"
                  style={{ borderColor: m.edited ? '#f59e0b' : undefined }}
                  styles={{ body: { padding: '8px 12px' } }}
                  title={
                    <Space size="small">
                      <Tag color={meta.color}>{meta.label}</Tag>
                      {m.model && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{m.model}</Typography.Text>}
                      {m.ts && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{dayjs(m.ts).format('MM-DD HH:mm')}</Typography.Text>}
                      {m.edited && <Tag color="warning">已编辑</Tag>}
                    </Space>
                  }
                  extra={
                    <Space size="small">
                      <Button
                        size="small"
                        type="text"
                        icon={<EditOutlined />}
                        onClick={() => setEditing({ index: i, content: m.content })}
                      />
                      {m.edited && (
                        <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => void doResetEdit(i)} />
                      )}
                    </Space>
                  }
                >
                  <Typography.Paragraph
                    style={{ marginBottom: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 320, overflow: 'auto', fontSize: 13 }}
                  >
                    {m.content}
                  </Typography.Paragraph>
                </Card>
              );
            })}
          </Space>
        )}
      </Drawer>

      <Modal
        title={editing ? `编辑消息 #${editing.index}` : ''}
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={doSaveEdit}
        okText="保存"
        cancelText="取消"
        width={720}
      >
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
          编辑保存在本地覆盖层中，不会修改原工具的会话文件；可随时还原。
        </Typography.Text>
        {editing && (
          <Input.TextArea
            rows={14}
            value={editing.content}
            onChange={(e) => setEditing({ ...editing, content: e.target.value })}
          />
        )}
      </Modal>

      {rows.length === 0 && !loading && (
        <Empty description="没有符合条件的会话，请先在顶部「扫描全部来源」" />
      )}
    </Space>
  );
}
