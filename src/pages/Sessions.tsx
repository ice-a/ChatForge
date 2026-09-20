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
  Segmented,
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
import { rebuildFtsSession, searchMessages, type FtsHit } from '../lib/fts';
import { useI18n } from '../i18n';
import dayjs from 'dayjs';

const ROLE_META: Record<string, { label: string; color: string }> = {
  user: { label: '用户', color: 'blue' },
  assistant: { label: '助手', color: 'green' },
  system: { label: '系统', color: 'orange' },
  tool: { label: '工具', color: 'default' },
};

export default function Sessions() {
  const { message, modal } = AntApp.useApp();
  const { t } = useI18n();
  const { homeDir, dataVersion } = useAppStore();
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [tools, setTools] = useState<ToolSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [tool, setTool] = useState('all');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [searchMode, setSearchMode] = useState<'meta' | 'fulltext'>('meta');
  const [ftsHits, setFtsHits] = useState<FtsHit[] | null>(null);
  const [ftsLoading, setFtsLoading] = useState(false);

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
      message.error(t('sess.loadFail', { msg: (e as Error).message }));
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
      message.error(t('sess.detailFail', { msg: (e as Error).message }));
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
    message.success(t('sess.titleUpdated'));
    await load();
    await reloadDetail();
  };

  const doSaveEdit = async () => {
    if (!detail || !editing) return;
    const db = await initDb(homeDir);
    await saveEdit(db, detail.row.id, editing.index, editing.content);
    await rebuildFtsSession(db, detail.row.id).catch(() => undefined);
    message.success(t('sess.msgUpdated', { n: editing.index }));
    setEditing(null);
    await reloadDetail();
    await load();
  };

  const doResetEdit = async (index: number) => {
    if (!detail) return;
    const db = await initDb(homeDir);
    await resetEdit(db, detail.row.id, index);
    await rebuildFtsSession(db, detail.row.id).catch(() => undefined);
    message.success(t('sess.restored'));
    await reloadDetail();
    await load();
  };

  const doResetAll = () => {
    if (!detail) return;
    modal.confirm({
      title: t('sess.resetConfirmTitle'),
      content: t('sess.resetConfirmContent'),
      onOk: async () => {
        const db = await initDb(homeDir);
        await resetSessionEdits(db, detail.row.id);
        await rebuildFtsSession(db, detail.row.id).catch(() => undefined);
        message.success(t('sess.allReset'));
        await reloadDetail();
        await load();
      },
    });
  };

  const doFtsSearch = async (q: string) => {
    if (!q.trim()) {
      setFtsHits(null);
      return;
    }
    setFtsLoading(true);
    try {
      const db = await initDb(homeDir);
      setFtsHits(await searchMessages(db, q, 80));
    } catch (e) {
      message.error(t('sess.ftsFail', { msg: (e as Error).message }));
    } finally {
      setFtsLoading(false);
    }
  };

  const hitTitle = (sessionId: string) => rows.find((r) => r.id === sessionId)?.title ?? sessionId;

  const columns: ColumnsType<SessionRow> = useMemo(
    () => [
      {
        title: t('sess.col.title'),
        dataIndex: 'title',
        key: 'title',
        ellipsis: { showTitle: false },
        render: (v: string, r: SessionRow) => (
          <Tooltip title={v}>
            <a onClick={() => void openDetail(r.id)}>{v}</a>
          </Tooltip>
        ),
      },
      { title: t('sess.col.tool'), dataIndex: 'tool', key: 'tool', width: 100, render: (v: string) => <Tag color="geekblue">{v}</Tag> },
      { title: t('sess.col.project'), dataIndex: 'project', key: 'project', width: 140, ellipsis: true, render: (v: string | null) => v ?? '—' },
      { title: t('sess.col.model'), dataIndex: 'model', key: 'model', width: 150, ellipsis: true, render: (v: string | null) => (v ? <Tag>{v}</Tag> : '—') },
      { title: t('sess.col.msgs'), dataIndex: 'message_count', key: 'message_count', width: 70, sorter: (a, b) => a.message_count - b.message_count },
      {
        title: t('sess.col.updated'),
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
        render: (_: unknown, r: SessionRow) => (Number(r.edited) > 0 ? <Badge status="warning" text={<Typography.Text type="warning" style={{ fontSize: 12 }}>{t('sess.edited')}</Typography.Text>} /> : null),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows],
  );

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Card size="small">
        <Space wrap>
          <Segmented
            value={searchMode}
            onChange={(v) => {
              setSearchMode(v as 'meta' | 'fulltext');
              if (v === 'meta') setFtsHits(null);
            }}
            options={[
              { value: 'meta', label: t('sess.meta') },
              { value: 'fulltext', label: t('sess.fulltext') },
            ]}
          />
          <Select
            value={tool}
            onChange={(v) => setTool(v)}
            style={{ width: 150 }}
            options={[{ value: 'all', label: t('dash.allTools') }, ...tools.map((t2) => ({ value: t2.tool, label: `${t2.tool} (${t2.sessions})` }))]}
          />
          <Input.Search
            placeholder={searchMode === 'meta' ? t('sess.searchMeta') : t('sess.searchFull')}
            allowClear
            style={{ width: 360 }}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onSearch={(v) => {
              setSearchInput(v);
              if (searchMode === 'fulltext') void doFtsSearch(v);
              else setSearch(v);
            }}
          />
          <Typography.Text type="secondary">
            {searchMode === 'fulltext'
              ? ftsHits
                ? t('sess.hitCount', { n: ftsHits.length })
                : t('sess.hitHint')
              : t('sess.sessionCount', { n: rows.length })}
          </Typography.Text>
        </Space>
      </Card>

      {searchMode === 'fulltext' ? (
        <Table<FtsHit>
          size="small"
          rowKey={(r) => `${r.session_id}::${r.msg_index}`}
          dataSource={ftsHits ?? []}
          loading={ftsLoading}
          pagination={{ pageSize: 15, showSizeChanger: false }}
          columns={[
            {
              title: t('sess.col.session'),
              key: 'session',
              width: 220,
              ellipsis: true,
              render: (_: unknown, r: FtsHit) => (
                <Tooltip title={hitTitle(r.session_id)}>
                  <a onClick={() => void openDetail(r.session_id)}>{hitTitle(r.session_id)}</a>
                </Tooltip>
              ),
            },
            {
              title: t('sess.col.role'),
              dataIndex: 'role',
              key: 'role',
              width: 80,
              render: (v: string) => <Tag color={ROLE_META[v]?.color ?? 'default'}>{ROLE_META[v] ? t(`sess.role.${v}`) : v}</Tag>,
            },
            {
              title: t('sess.col.snippet'),
              dataIndex: 'snippet',
              key: 'snippet',
              render: (v: string) => (
                <Typography.Text style={{ fontSize: 13 }} type="secondary">
                  {v}
                </Typography.Text>
              ),
            },
          ]}
        />
      ) : (
        <Table<SessionRow>
          size="small"
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={loading}
          pagination={{ pageSize: 20, showSizeChanger: false }}
        />
      )}

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
            t('sess.sessionDetail')
          )
        }
        extra={
          detail && Number(detail.row.edited) > 0 ? (
            <Button size="small" icon={<RedoOutlined />} onClick={doResetAll}>
              {t('sess.restoreAll')}
            </Button>
          ) : null
        }
        styles={{ body: { padding: 16 } }}
      >
        {detailLoading || !detail ? (
          <Typography.Text type="secondary">{t('sess.loading')}</Typography.Text>
        ) : (
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            <Space wrap size="small">
              <Tag color="geekblue">{detail.row.tool}</Tag>
              {detail.row.model && <Tag>{detail.row.model}</Tag>}
              {detail.row.project && <Tag color="purple">{detail.row.project}</Tag>}
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t('sess.msgCount', { n: detail.messages.length })} · {t('sess.col.updated')} {dayjs(detail.row.updated_at).format('YYYY-MM-DD HH:mm')}
              </Typography.Text>
            </Space>
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }} copyable={{ text: detail.row.source_path }}>
              {t('sess.source')}{detail.row.source_path}
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
                      {m.edited && <Tag color="warning">{t('sess.editedBadge')}</Tag>}
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
        title={editing ? t('sess.editTitle', { n: editing.index }) : ''}
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={doSaveEdit}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        width={720}
      >
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
          {t('sess.editHint')}
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
        <Empty description={t('sess.empty')} />
      )}
    </Space>
  );
}
