import { useEffect, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import {
  Boxes,
  ChevronDown,
  ChevronRight,
  Copy,
  Database,
  Eraser,
  Eye,
  FileJson,
  FileSpreadsheet,
  Folder,
  FolderOpen,
  KeyRound,
  Layers3,
  Link2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Table2,
  Terminal,
  Trash2,
  Unlink,
  Wrench,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import {
  classNames,
  defaultSchemaFor,
  downloadUrl,
  driverHasSchemas,
  driverSupportsCreateDatabase,
  driverSupportsSQLQuery,
  driverSupportsTableDesign,
  formatNumber,
  driverLabel,
  suggestSqlForTable,
} from '../lib/utils';
import { useAppStore } from '../store/appStore';
import type {
  Connection,
  DatabaseInfo,
  ObjectInfo,
} from '../types';
import { ContextMenu, EmptyState, Spinner } from './ui';
import type { MenuItem } from './ui';
import { CreateTableDialog, NewDatabaseDialog } from './CreateTableDialog';

interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

interface CreateTableTargetState {
  connection: Connection;
  database: string;
  schema: string;
}

const nodeConnection = (id: string) => `conn:${id}`;
const nodeDatabase = (id: string, database: string) => `db:${id}:${database}`;
const nodeSchema = (id: string, database: string, schema: string) => `schema:${id}:${database}:${schema}`;
const dataKey = (id: string, database: string) => `${id}::${database}`;
const objectKey = (id: string, database: string, schema: string) => `${id}::${database}::${schema}`;

export function Sidebar({ width }: { width: number }) {
  const connections = useAppStore((state) => state.connections);
  const loadingConnections = useAppStore((state) => state.connectionsLoading);
  const loadConnections = useAppStore((state) => state.loadConnections);
  const setConnected = useAppStore((state) => state.setConnectionConnected);
  const openConnectionDialog = useAppStore((state) => state.openConnectionDialog);
  const openQuery = useAppStore((state) => state.openQuery);
  const openRedis = useAppStore((state) => state.openRedis);
  const openChroma = useAppStore((state) => state.openChroma);
  const openTable = useAppStore((state) => state.openTable);
  const requestConfirm = useAppStore((state) => state.requestConfirm);
  const toast = useAppStore((state) => state.toast);
  const bumpData = useAppStore((state) => state.bumpData);
  const dataVersion = useAppStore((state) => state.dataVersion);

  const [openNodes, setOpenNodes] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [databases, setDatabases] = useState<Record<string, DatabaseInfo[]>>({});
  const [schemas, setSchemas] = useState<Record<string, string[]>>({});
  const [objects, setObjects] = useState<Record<string, ObjectInfo[]>>({});
  const [loadingNodes, setLoadingNodes] = useState<Set<string>>(new Set());
  const [busyConnections, setBusyConnections] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [createTableTarget, setCreateTableTarget] = useState<CreateTableTargetState | null>(null);
  const [newDatabaseFor, setNewDatabaseFor] = useState<Connection | null>(null);

  const searchTerm = search.trim().toLowerCase();
  const connectedCount = connections.filter((connection) => connection.connected).length;

  const isOpen = (key: string) => openNodes.has(key);
  const isLoading = (key: string) => loadingNodes.has(key);

  const markOpen = (key: string, open: boolean) => {
    setOpenNodes((current) => {
      const next = new Set(current);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });
  };
  const markLoading = (key: string, value: boolean) => {
    setLoadingNodes((current) => {
      const next = new Set(current);
      if (value) next.add(key);
      else next.delete(key);
      return next;
    });
  };
  const markBusy = (id: string, value: boolean) => {
    setBusyConnections((current) => {
      const next = new Set(current);
      if (value) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const closeConnectionNodes = (connId: string) => {
    setOpenNodes((current) => {
      const next = new Set<string>();
      current.forEach((key) => {
        if (!key.startsWith(`conn:${connId}`) && !key.startsWith(`db:${connId}:`) && !key.startsWith(`schema:${connId}:`)) {
          next.add(key);
        }
      });
      return next;
    });
  };

  const connectConnection = async (connection: Connection): Promise<boolean> => {
    if (busyConnections.has(connection.id)) return false;
    markBusy(connection.id, true);
    try {
      await api.connect(connection.id);
      setConnected(connection.id, true);
      toast('success', `已连接 ${connection.name}`);
      return true;
    } catch (connectError) {
      setConnected(connection.id, false);
      toast('error', '连接失败', connectError instanceof Error ? connectError.message : String(connectError));
      return false;
    } finally {
      markBusy(connection.id, false);
    }
  };

  const loadDatabases = async (connection: Connection, force = false): Promise<DatabaseInfo[] | null> => {
    if (!force && databases[connection.id]) return databases[connection.id];
    const nodeKey = nodeConnection(connection.id);
    if (isLoading(nodeKey)) return null;
    markLoading(nodeKey, true);
    try {
      const response = await api.databases(connection.id);
      setDatabases((current) => ({ ...current, [connection.id]: response.databases }));
      setConnected(connection.id, true);
      return response.databases;
    } catch (loadError) {
      toast('error', '读取数据库失败', loadError instanceof Error ? loadError.message : String(loadError));
      return null;
    } finally {
      markLoading(nodeKey, false);
    }
  };

  const loadSchemas = async (connection: Connection, database: string, force = false): Promise<string[] | null> => {
    const cacheKey = dataKey(connection.id, database);
    if (!force && schemas[cacheKey]) return schemas[cacheKey];
    const nodeKey = nodeDatabase(connection.id, database);
    if (isLoading(nodeKey)) return null;
    markLoading(nodeKey, true);
    try {
      const response = await api.schemas(connection.id, database);
      setSchemas((current) => ({ ...current, [cacheKey]: response.schemas }));
      return response.schemas;
    } catch (loadError) {
      toast('error', '读取 Schema 失败', loadError instanceof Error ? loadError.message : String(loadError));
      return null;
    } finally {
      markLoading(nodeKey, false);
    }
  };

  const loadObjects = async (
    connection: Connection,
    database: string,
    schema: string,
    force = false,
  ): Promise<ObjectInfo[] | null> => {
    const cacheKey = objectKey(connection.id, database, schema);
    if (!force && objects[cacheKey]) return objects[cacheKey];
    const nodeKey = driverHasSchemas(connection.driver)
      ? nodeSchema(connection.id, database, schema)
      : nodeDatabase(connection.id, database);
    if (isLoading(nodeKey)) return null;
    markLoading(nodeKey, true);
    try {
      const response = await api.objects(connection.id, database, schema);
      setObjects((current) => ({ ...current, [cacheKey]: response.objects }));
      setConnected(connection.id, true);
      return response.objects;
    } catch (loadError) {
      toast('error', '读取对象失败', loadError instanceof Error ? loadError.message : String(loadError));
      return null;
    } finally {
      markLoading(nodeKey, false);
    }
  };

  useEffect(() => {
    if (dataVersion === 0) return;
    const connectionMap = new Map(connections.map((connection) => [connection.id, connection]));
    Object.keys(objects).forEach((key) => {
      const [connId, database, schema] = key.split('::');
      const connection = connectionMap.get(connId);
      if (connection) void loadObjects(connection, database, schema, true);
    });
    connections.forEach((connection) => {
      if (databases[connection.id]) void loadDatabases(connection, true);
    });
    // 只在全局数据版本变化时刷新已展开的对象树缓存
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion]);

  const toggleConnection = async (connection: Connection) => {    const key = nodeConnection(connection.id);
    setSelected(key);
    if (isOpen(key)) {
      markOpen(key, false);
      return;
    }
    if (busyConnections.has(connection.id)) return;
    markOpen(key, true);
    if (!connection.connected) {
      const connected = await connectConnection(connection);
      if (!connected) {
        markOpen(key, false);
        return;
      }
    }
    await loadDatabases(connection);
  };

  const toggleDatabase = async (connection: Connection, database: DatabaseInfo) => {
    const key = nodeDatabase(connection.id, database.name);
    setSelected(key);
    if (isOpen(key)) {
      markOpen(key, false);
      return;
    }
    if (!connection.connected) {
      const connected = await connectConnection(connection);
      if (!connected) return;
    }
    markOpen(key, true);
    if (driverHasSchemas(connection.driver)) {
      const schemaList = await loadSchemas(connection, database.name);
      if (schemaList && schemaList.length > 0) {
        const initial = pickSchema(connection, schemaList);
        const schemaNode = nodeSchema(connection.id, database.name, initial);
        markOpen(schemaNode, true);
        await loadObjects(connection, database.name, initial);
      }
    } else {
      const schema = connection.driver === 'sqlite' ? 'main' : database.name;
      await loadObjects(connection, database.name, schema);
    }
  };

  const toggleSchema = async (connection: Connection, database: string, schema: string) => {
    const key = nodeSchema(connection.id, database, schema);
    setSelected(key);
    if (isOpen(key)) {
      markOpen(key, false);
      return;
    }
    markOpen(key, true);
    await loadObjects(connection, database, schema);
  };

  const ensureConnectedForAction = async (connection: Connection): Promise<boolean> => {
    if (connection.connected) return true;
    return connectConnection(connection);
  };

  const newQuery = async (connection: Connection, database?: string, schema?: string, sql?: string, title?: string) => {
    const connected = await ensureConnectedForAction(connection);
    if (!connected) return;
    openQuery(connection, {
      database: database || connection.database,
      schema,
      sql,
      title,
    });
  };

  const handleDisconnect = async (connection: Connection) => {
    try {
      await api.disconnect(connection.id);
      setConnected(connection.id, false);
      closeConnectionNodes(connection.id);
      toast('success', `已断开 ${connection.name}`);
    } catch (disconnectError) {
      toast('error', '断开连接失败', disconnectError instanceof Error ? disconnectError.message : String(disconnectError));
    }
  };

  const showMenu = (event: ReactMouseEvent, items: MenuItem[]) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY, items });
  };

  const showMenuAtButton = (event: ReactMouseEvent<HTMLButtonElement>, items: MenuItem[]) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({ x: rect.right - 4, y: rect.bottom + 2, items });
  };

  const copyName = (name: string) => {
    void navigator.clipboard
      .writeText(name)
      .then(() => toast('success', '名称已复制'))
      .catch(() => toast('error', '复制失败'));
  };

  const deleteChromaCollection = (connection: Connection, database: string, object: ObjectInfo) => {
    requestConfirm({
      title: '删除集合',
      message: `确定删除集合「${object.name}」吗？集合中的文档与向量会一并删除，此操作不可恢复。`,
      confirmText: '删除集合',
      danger: true,
      onConfirm: async () => {
        await api.chromaDeleteCollection(connection.id, object.id || object.name);
        setObjects((current) => {
          const cacheKey = objectKey(connection.id, database, database);
          const list = current[cacheKey];
          if (!list) return current;
          return { ...current, [cacheKey]: list.filter((item) => item.name !== object.name) };
        });
        await loadDatabases(connection, true);
        bumpData();
        toast('success', '集合已删除', object.name);
      },
    });
  };

  const deleteRedisKey = (connection: Connection, database: string, key: string) => {
    requestConfirm({
      title: '删除 Redis 键',
      message: `确定删除键「${key}」吗？此操作不可撤销。`,
      confirmText: '删除键',
      danger: true,
      onConfirm: async () => {
        await api.deleteRedisKey(connection.id, database, key);
        const cacheKey = objectKey(connection.id, database, database);
        setObjects((current) => {
          const list = current[cacheKey];
          if (!list) return current;
          return { ...current, [cacheKey]: list.filter((item) => item.name !== key) };
        });
        bumpData();
        toast('success', '键已删除', key);
      },
    });
  };

  const dropDatabase = (connection: Connection, database: string) => {
    requestConfirm({
      title: '删除数据库',
      message: `确定删除数据库「${database}」吗？数据库中的所有表和数据都会被永久删除，此操作不可撤销。`,
      confirmText: '删除数据库',
      danger: true,
      onConfirm: async () => {
        await api.dropDatabase(connection.id, database);
        const state = useAppStore.getState();
        state.tabs
          .filter((tab) => tab.kind !== 'welcome' && tab.connectionId === connection.id && tab.database === database)
          .forEach((tab) => state.closeTab(tab.id));
        setDatabases((current) => {
          const list = current[connection.id];
          if (!list) return current;
          return { ...current, [connection.id]: list.filter((item) => item.name !== database) };
        });
        setSchemas((current) => {
          const next = { ...current };
          Object.keys(next).forEach((key) => {
            if (key.startsWith(`${connection.id}::${database}`)) delete next[key];
          });
          return next;
        });
        setObjects((current) => {
          const next = { ...current };
          Object.keys(next).forEach((key) => {
            if (key.startsWith(`${connection.id}::${database}::`)) delete next[key];
          });
          return next;
        });
        bumpData();
        toast('success', '数据库已删除', database);
        void loadDatabases(connection, true);
      },
    });
  };

  const dropObject = (connection: Connection, database: string, schema: string, object: ObjectInfo) => {
    const label = object.type === 'view' ? '视图' : object.type === 'collection' ? '集合' : '表';
    requestConfirm({
      title: `删除${label}`,
      message: `确定删除${label}「${object.name}」吗？其中的数据和定义将被永久删除，此操作不可撤销。`,
      confirmText: `删除${label}`,
      danger: true,
      onConfirm: async () => {
        await api.dropTable(connection.id, { database, schema, table: object.name }, object.type);
        const state = useAppStore.getState();
        state.closeTab(`table:${connection.id}:${database}:${schema}:${object.name}`);
        setObjects((current) => {
          const cacheKey = objectKey(connection.id, database, schema);
          const list = current[cacheKey];
          if (!list) return current;
          return { ...current, [cacheKey]: list.filter((item) => item.name !== object.name) };
        });
        void loadDatabases(connection, true);
        bumpData();
        toast('success', `${label}已删除`, object.name);
      },
    });
  };

  const truncateTable = (connection: Connection, database: string, schema: string, table: string) => {
    requestConfirm({
      title: '清空表数据',
      message: `确定清空表「${table}」中的所有数据吗？表结构会保留，数据不可恢复。`,
      confirmText: '清空表',
      danger: true,
      onConfirm: async () => {
        const result = await api.truncateTable(connection.id, { database, schema, table });
        bumpData();
        toast('success', '表数据已清空', `${formatNumber(result.affectedRows)} 行受影响`);
        await loadObjects(connection, database, schema, true);
      },
    });
  };

  const connectionMenuItems = (connection: Connection): MenuItem[] => [
    {
      label: connection.connected ? '断开连接' : '连接',
      icon: connection.connected ? <Unlink size={13} /> : <Link2 size={13} />,
      onClick: () => {
        if (connection.connected) void handleDisconnect(connection);
        else void (async () => {
          const connected = await connectConnection(connection);
          if (connected) {
            markOpen(nodeConnection(connection.id), true);
            await loadDatabases(connection, true);
          }
        })();
      },
    },
    ...(connection.driver === 'redis'
      ? [{
          label: '打开 Redis 工作台',
          icon: <Boxes size={13} />,
          onClick: () => openRedis(connection),
        }]
      : connection.driver === 'chroma'
        ? [{
            label: '打开 Chroma 工作台',
            icon: <Layers3 size={13} />,
            onClick: () => openChroma(connection),
          }]
        : [{
            label: '新建查询',
            icon: <Terminal size={13} />,
            onClick: () => void newQuery(connection),
          }]),
    { label: '', separator: true },
    {
      label: '刷新',
      icon: <RefreshCw size={13} />,
      disabled: !connection.connected,
      onClick: () => void (async () => {
        markOpen(nodeConnection(connection.id), true);
        await loadDatabases(connection, true);
      })(),
    },
    {
      label: '编辑连接',
      icon: <Pencil size={13} />,
      onClick: () => openConnectionDialog(connection),
    },
    ...(driverSupportsCreateDatabase(connection.driver)
      ? [{
          label: '新建数据库',
          icon: <Database size={13} />,
          onClick: () => setNewDatabaseFor(connection),
        }]
      : []),
    { label: '', separator: true },
    {
      label: '删除连接',
      icon: <Trash2 size={13} />,
      danger: true,
      onClick: () =>
        requestConfirm({
          title: '删除连接',
          message: `确定删除连接「${connection.name}」吗？只会移除保存的连接配置，不会影响数据库数据。`,
          confirmText: '删除连接',
          danger: true,
          onConfirm: async () => {
            await api.deleteConnection(connection.id);
            useAppStore.getState().closeTabsForConnection(connection.id);
            setConnected(connection.id, false);
            closeConnectionNodes(connection.id);
            setDatabases((current) => {
              const next = { ...current };
              delete next[connection.id];
              return next;
            });
            setSchemas((current) => {
              const next = { ...current };
              Object.keys(next).forEach((key) => {
                if (key.startsWith(`${connection.id}::`)) delete next[key];
              });
              return next;
            });
            setObjects((current) => {
              const next = { ...current };
              Object.keys(next).forEach((key) => {
                if (key.startsWith(`${connection.id}::`)) delete next[key];
              });
              return next;
            });
            await loadConnections();
            toast('success', '连接已删除');
          },
        }),
    },
  ];

  const databaseMenuItems = (connection: Connection, database: string): MenuItem[] => [
    ...(connection.driver === 'redis'
      ? [{
          label: '打开 Redis 工作台',
          icon: <Boxes size={13} />,
          onClick: () => openRedis(connection, { database }),
        }]
      : []),
    ...(connection.driver === 'chroma'
      ? [{
          label: '打开 Chroma 工作台',
          icon: <Layers3 size={13} />,
          onClick: () => openChroma(connection, { database }),
        }]
      : []),
    ...(driverSupportsSQLQuery(connection.driver)
      ? [{
          label: '新建查询',
          icon: <Terminal size={13} />,
          onClick: () => void newQuery(connection, database),
        }]
      : []),
    ...(driverSupportsTableDesign(connection.driver)
      ? [{
          label: '新建表',
          icon: <Table2 size={13} />,
          onClick: () => setCreateTableTarget({
            connection,
            database,
            schema: defaultSchemaFor(connection.driver, connection, database),
          }),
        }]
      : []),
    { label: '', separator: true },
    {
      label: '刷新',
      icon: <RefreshCw size={13} />,
      onClick: () => void (async () => {
        markOpen(nodeDatabase(connection.id, database), true);
        if (driverHasSchemas(connection.driver)) {
          await loadSchemas(connection, database, true);
        } else {
          await loadObjects(connection, database, connection.driver === 'sqlite' ? 'main' : database, true);
        }
      })(),
    },
    {
      label: '复制名称',
      icon: <Copy size={13} />,
      onClick: () => copyName(database),
    },
    ...(driverSupportsCreateDatabase(connection.driver) && !systemDatabase(connection.driver, database)
      ? [
          { label: '', separator: true },
          {
            label: '删除数据库',
            icon: <Trash2 size={13} />,
            danger: true,
            onClick: () => dropDatabase(connection, database),
          },
        ]
      : []),
  ];

  const schemaMenuItems = (connection: Connection, database: string, schema: string): MenuItem[] => [
    {
      label: '新建查询',
      icon: <Terminal size={13} />,
      onClick: () => void newQuery(connection, database, schema),
    },
    {
      label: '新建表',
      icon: <Table2 size={13} />,
      onClick: () => setCreateTableTarget({ connection, database, schema }),
    },
    { label: '', separator: true },
    {
      label: '刷新',
      icon: <RefreshCw size={13} />,
      onClick: () => void (async () => {
        markOpen(nodeSchema(connection.id, database, schema), true);
        await loadObjects(connection, database, schema, true);
      })(),
    },
    {
      label: '复制名称',
      icon: <Copy size={13} />,
      onClick: () => copyName(schema),
    },
  ];

  const objectMenuItems = (connection: Connection, database: string, schema: string, object: ObjectInfo): MenuItem[] => {
    const target = { connectionId: connection.id, database, schema, table: object.name };
    if (connection.driver === 'chroma') {
      return [
        {
          label: '在 Chroma 工作台中打开',
          icon: <Layers3 size={13} />,
          onClick: () => openChroma(connection, { database, collection: object.name, collectionId: object.id }),
        },
        {
          label: '复制名称',
          icon: <Copy size={13} />,
          onClick: () => copyName(object.name),
        },
        { label: '', separator: true },
        {
          label: '删除集合',
          icon: <Trash2 size={13} />,
          danger: true,
          onClick: () => deleteChromaCollection(connection, database, object),
        },
      ];
    }
    if (object.type === 'key') {
      return [
        {
          label: '在 Redis 工作台中打开',
          icon: <KeyRound size={13} />,
          onClick: () => openRedis(connection, { database, key: object.name }),
        },
        {
          label: '复制名称',
          icon: <Copy size={13} />,
          onClick: () => copyName(object.name),
        },
        { label: '', separator: true },
        {
          label: '删除键',
          icon: <Trash2 size={13} />,
          danger: true,
          onClick: () => deleteRedisKey(connection, database, object.name),
        },
      ];
    }
    const isCollection = object.type === 'collection';
    return [
      {
        label: isCollection ? '打开集合' : '打开数据',
        icon: <Table2 size={13} />,
        onClick: () => openTable({ ...target, objectType: object.type, mode: 'data' }),
      },
      {
        label: isCollection ? '查看字段' : '查看结构',
        icon: <FolderOpen size={13} />,
        onClick: () => openTable({ ...target, objectType: object.type, mode: 'structure' }),
      },
      ...(object.type === 'table'
        ? [{
            label: '设计表',
            icon: <Wrench size={13} />,
            onClick: () => openTable({ ...target, objectType: object.type, mode: 'design' }),
          }]
        : []),
      ...(driverSupportsSQLQuery(connection.driver)
        ? [{
            label: '新建查询',
            icon: <Terminal size={13} />,
            onClick: () => void newQuery(
              connection,
              database,
              schema,
              suggestSqlForTable(connection.driver, database, schema, object.name),
              `${object.name} 查询`,
            ),
          }]
        : []),
      { label: '', separator: true },
      {
        label: '复制名称',
        icon: <Copy size={13} />,
        onClick: () => copyName(object.name),
      },
      {
        label: '导出 CSV',
        icon: <FileSpreadsheet size={13} />,
        onClick: () => {
          downloadUrl(api.exportUrl(connection.id, { database, schema, table: object.name }, 'csv'));
          toast('success', '正在导出 CSV');
        },
      },
      {
        label: '导出 JSON',
        icon: <FileJson size={13} />,
        onClick: () => {
          downloadUrl(api.exportUrl(connection.id, { database, schema, table: object.name }, 'json'));
          toast('success', '正在导出 JSON');
        },
      },
      ...(object.type === 'table'
        ? [
            { label: '', separator: true },
            {
              label: '清空表数据',
              icon: <Eraser size={13} />,
              danger: true,
              onClick: () => truncateTable(connection, database, schema, object.name),
            },
          ]
        : []),
      {
        label: object.type === 'view' ? '删除视图' : isCollection ? '删除集合' : '删除表',
        icon: <Trash2 size={13} />,
        danger: true,
        onClick: () => dropObject(connection, database, schema, object),
      },
    ];
  };

  const renderObject = (
    connection: Connection,
    database: string,
    schema: string,
    object: ObjectInfo,
    depth: number,
  ) => {
    if (searchTerm && !object.name.toLowerCase().includes(searchTerm)) return null;
    const objectId = `${connection.id}:${database}:${schema}:${object.name}`;
    return (
      <div
        key={objectId}
        className={classNames('tree-row', 'tree-object', selected === objectId && 'selected')}
        style={{ paddingLeft: depth * 14 + 8 }}
        onClick={() => {
          setSelected(objectId);
          if (connection.driver === 'chroma') {
            openChroma(connection, { database, collection: object.name, collectionId: object.id });
          } else if (object.type === 'key') {
            openRedis(connection, { database, key: object.name });
          } else {
            openTable({ connectionId: connection.id, database, schema, table: object.name, objectType: object.type, mode: 'data' });
          }
        }}
        onContextMenu={(event) => {
          setSelected(objectId);
          showMenu(event, objectMenuItems(connection, database, schema, object));
        }}
        title={`${object.name} · ${object.type === 'view' ? '视图' : object.type === 'collection' ? '集合' : object.type === 'key' ? object.engine || '键' : '表'}`}
      >
        <span className="tree-spacer" />
        <span className={classNames('tree-object-icon', object.type)}>
          {object.type === 'view' ? <Eye size={13} />
            : object.type === 'collection' ? <Layers3 size={13} />
              : object.type === 'key' ? <KeyRound size={13} />
                : <Table2 size={13} />}
        </span>
        <span className="tree-label">{object.name}</span>
        {object.rows > 0 && object.type !== 'key' ? <span className="tree-count">{formatNumber(object.rows)}</span> : null}
        <span className="tree-row-actions">
          <button
            type="button"
            className="icon-btn tiny"
            title={object.type === 'key' ? '查看键值' : object.type === 'collection' ? '打开集合' : '打开表'}
            onClick={(event) => {
              event.stopPropagation();
              setSelected(objectId);
              if (connection.driver === 'chroma') {
                openChroma(connection, { database, collection: object.name, collectionId: object.id });
              } else if (object.type === 'key') {
                openRedis(connection, { database, key: object.name });
              } else {
                openTable({ connectionId: connection.id, database, schema, table: object.name, objectType: object.type, mode: 'data' });
              }
            }}
          >
            {object.type === 'key' ? <KeyRound size={12} /> : object.type === 'collection' ? <Layers3 size={12} /> : <Table2 size={12} />}
          </button>
          <button
            type="button"
            className="icon-btn tiny"
            title="更多操作"
            onClick={(event) => {
              event.stopPropagation();
              showMenuAtButton(event, objectMenuItems(connection, database, schema, object));
            }}
          >
            <MoreHorizontal size={13} />
          </button>
        </span>
      </div>
    );
  };

  const renderSchema = (connection: Connection, database: string, schema: string, depth: number) => {
    const key = nodeSchema(connection.id, database, schema);
    const cacheKey = objectKey(connection.id, database, schema);
    const schemaObjects = objects[cacheKey];
    const open = isOpen(key);
    const loading = isLoading(key);
    return (
      <div key={key} className="tree-branch">
        <div
          className={classNames('tree-row', 'tree-schema', selected === key && 'selected')}
          style={{ paddingLeft: depth * 14 + 8 }}
          onClick={() => void toggleSchema(connection, database, schema)}
          onContextMenu={(event) => {
            setSelected(key);
            showMenu(event, schemaMenuItems(connection, database, schema));
          }}
        >
          <span className="tree-chevron">
            {loading ? <Spinner size={11} /> : open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
          <span className="tree-object-icon schema">{open ? <FolderOpen size={13} /> : <Folder size={13} />}</span>
          <span className="tree-label">{schema}</span>
          {schemaObjects ? <span className="tree-count">{schemaObjects.length}</span> : null}
          <span className="tree-row-actions">
            <button
              type="button"
              className="icon-btn tiny"
              title="新建查询"
              onClick={(event) => {
                event.stopPropagation();
                void newQuery(connection, database, schema);
              }}
            >
              <Terminal size={12} />
            </button>
            <button
              type="button"
              className="icon-btn tiny"
              title="更多操作"
              onClick={(event) => {
                event.stopPropagation();
                showMenuAtButton(event, schemaMenuItems(connection, database, schema));
              }}
            >
              <MoreHorizontal size={13} />
            </button>
          </span>
        </div>
        {open ? (
          <div className="tree-children">
            {loading && !schemaObjects ? (
              <LoadingRows depth={depth + 1} />
            ) : schemaObjects && schemaObjects.length > 0 ? (
              schemaObjects.map((object) => renderObject(connection, database, schema, object, depth + 1))
            ) : (
              <div className="tree-message" style={{ paddingLeft: (depth + 1) * 14 + 24 }}>
                {searchTerm ? '没有匹配的对象' : '没有表或视图'}
              </div>
            )}
          </div>
        ) : null}
      </div>
    );
  };

  const renderDatabase = (connection: Connection, database: DatabaseInfo, depth: number) => {
    const key = nodeDatabase(connection.id, database.name);
    const open = isOpen(key);
    const loading = isLoading(key);
    const hasSchemas = driverHasSchemas(connection.driver);
    const schemaList = schemas[dataKey(connection.id, database.name)];
    const schema = connection.driver === 'sqlite' ? 'main' : database.name;
    const objectList = objects[objectKey(connection.id, database.name, schema)];
    return (
      <div key={key} className="tree-branch">
        <div
          className={classNames('tree-row', 'tree-db', selected === key && 'selected')}
          style={{ paddingLeft: depth * 14 + 8 }}
          onClick={() => void toggleDatabase(connection, database)}
          onContextMenu={(event) => {
            setSelected(key);
            showMenu(event, databaseMenuItems(connection, database.name));
          }}
        >
          <span className="tree-chevron">
            {loading ? <Spinner size={11} /> : open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
          <span className={classNames('tree-object-icon', 'database', database.isSystem && 'system')}>
            <Database size={13} />
          </span>
          <span className="tree-label">{database.name}</span>
          {database.tableCount > 0 ? <span className="tree-count">{formatNumber(database.tableCount)}</span> : null}
          {database.isSystem ? <span className="tree-system">系统</span> : null}
          <span className="tree-row-actions">
            <button
              type="button"
              className="icon-btn tiny"
              title="新建查询"
              onClick={(event) => {
                event.stopPropagation();
                void newQuery(connection, database.name);
              }}
            >
              <Terminal size={12} />
            </button>
            <button
              type="button"
              className="icon-btn tiny"
              title="更多操作"
              onClick={(event) => {
                event.stopPropagation();
                showMenuAtButton(event, databaseMenuItems(connection, database.name));
              }}
            >
              <MoreHorizontal size={13} />
            </button>
          </span>
        </div>
        {open ? (
          <div className="tree-children">
            {hasSchemas ? (
              loading && !schemaList ? (
                <LoadingRows depth={depth + 1} />
              ) : schemaList && schemaList.length > 0 ? (
                schemaList.map((schemaName) => renderSchema(connection, database.name, schemaName, depth + 1))
              ) : (
                <div className="tree-message" style={{ paddingLeft: (depth + 1) * 14 + 24 }}>没有 Schema</div>
              )
            ) : loading && !objectList ? (
              <LoadingRows depth={depth + 1} />
            ) : objectList && objectList.length > 0 ? (
              objectList.map((object) => renderObject(connection, database.name, schema, object, depth + 1))
            ) : (
              <div className="tree-message" style={{ paddingLeft: (depth + 1) * 14 + 24 }}>
                {searchTerm ? '没有匹配的对象' : '没有表或视图'}
              </div>
            )}
          </div>
        ) : null}
      </div>
    );
  };

  const renderConnection = (connection: Connection) => {
    const key = nodeConnection(connection.id);
    const open = isOpen(key);
    const busy = busyConnections.has(connection.id);
    const dbList = databases[connection.id];
    const loading = isLoading(key);
    return (
      <div className="tree-branch connection-branch" key={key}>
        <div
          className={classNames('tree-row', 'tree-connection', selected === key && 'selected', !connection.connected && 'disconnected')}
          onClick={() => void toggleConnection(connection)}
          onContextMenu={(event) => {
            setSelected(key);
            showMenu(event, connectionMenuItems(connection));
          }}
          title={`${connection.name} · ${driverLabel(connection.driver)}`}
        >
          <span className="tree-chevron">
            {busy || loading ? <Spinner size={11} /> : open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
          <span
            className="tree-conn-icon"
            style={{
              color: connection.color,
              backgroundColor: `${connection.color}1f`,
              borderColor: `${connection.color}40`,
            }}
          >
            <Database size={12} />
          </span>
          <span className="tree-label">{connection.name}</span>
          {connection.readOnly ? <span className="tree-lock" title="只读连接">RO</span> : null}
          <span className={classNames('status-dot', connection.connected && 'online')} />
          <span className="tree-row-actions" onClick={(event) => event.stopPropagation()}>
            {connection.connected ? (
              <button type="button" className="icon-btn tiny" title="断开连接" onClick={() => void handleDisconnect(connection)}>
                <Unlink size={12} />
              </button>
            ) : (
              <button
                type="button"
                className="icon-btn tiny"
                title="连接"
                onClick={() => void (async () => {
                  const connected = await connectConnection(connection);
                  if (connected) {
                    markOpen(key, true);
                    await loadDatabases(connection, true);
                  }
                })()}
              >
                <Link2 size={12} />
              </button>
            )}
            <button
              type="button"
              className="icon-btn tiny"
              title={connection.driver === 'chroma' ? '打开 Chroma 工作台' : '新建查询'}
              onClick={() => {
                if (connection.driver === 'chroma') openChroma(connection);
                else void newQuery(connection);
              }}
            >
              {connection.driver === 'chroma' ? <Layers3 size={12} /> : <Terminal size={12} />}
            </button>
            <button
              type="button"
              className="icon-btn tiny"
              title="更多操作"
              onClick={(event) => showMenuAtButton(event, connectionMenuItems(connection))}
            >
              <MoreHorizontal size={13} />
            </button>
          </span>
        </div>
        {open ? (
          <div className="tree-children">
            {loading && !dbList ? (
              <LoadingRows depth={1} />
            ) : dbList && dbList.length > 0 ? (
              dbList.map((database) => renderDatabase(connection, database, 1))
            ) : (
              <div className="tree-message" style={{ paddingLeft: 32 }}>
                {connection.connected ? '没有可用的数据库' : '连接后加载数据库'}
              </div>
            )}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <aside className="sidebar" style={{ width }}>
      <div className="sidebar-header">
        <div className="sidebar-title">
          <span>连接</span>
          <span className="sidebar-count">{connections.length}</span>
        </div>
        <div className="sidebar-header-actions">
          <button type="button" className="icon-btn" title="刷新连接" onClick={() => void loadConnections()}>
            <RefreshCw size={14} />
          </button>
          <button type="button" className="icon-btn" title="新建连接" onClick={() => openConnectionDialog()}>
            <Plus size={15} />
          </button>
        </div>
      </div>

      <div className="sidebar-search">
        <Search size={14} />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="筛选已加载的表 / 视图"
          aria-label="筛选表或视图"
        />
        {search ? (
          <button type="button" className="icon-btn tiny" onClick={() => setSearch('')} title="清除">
            <X size={12} />
          </button>
        ) : null}
      </div>

      <div className="tree-scroll">
        {loadingConnections && connections.length === 0 ? (
          <div className="sidebar-loading">
            <Spinner size={16} /> 正在加载连接…
          </div>
        ) : connections.length === 0 ? (
          <div className="sidebar-empty">
            <EmptyState
              compact
              icon={<Database size={22} />}
              title="还没有连接"
              description="添加 SQL、文档、键值数据库，或通过云厂商模板创建连接。"
              action={
                <button type="button" className="btn btn-small btn-primary" onClick={() => openConnectionDialog()}>
                  <Plus size={12} /> 新建连接
                </button>
              }
            />
          </div>
        ) : (
          <div className="tree-root">{connections.map(renderConnection)}</div>
        )}
      </div>

      <div className="sidebar-footer">
        <span className="status-dot online" />
        {connectedCount} 个连接在线
        <span className="toolbar-spacer" />
        <span>{connections.length} 个已保存</span>
      </div>

      {menu ? (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      ) : null}

      {createTableTarget ? (
        <CreateTableDialog
          open
          connection={createTableTarget.connection}
          database={createTableTarget.database}
          schema={createTableTarget.schema}
          onClose={() => setCreateTableTarget(null)}
          onCreated={(table) => {
            const target = createTableTarget;
            if (!target) return;
            markOpen(nodeDatabase(target.connection.id, target.database), true);
            if (driverHasSchemas(target.connection.driver)) {
              markOpen(nodeSchema(target.connection.id, target.database, target.schema), true);
            }
            void loadObjects(target.connection, target.database, target.schema, true);
            void loadDatabases(target.connection, true);
            bumpData();
            openTable({
              connectionId: target.connection.id,
              database: target.database,
              schema: target.schema,
              table,
              objectType: 'table',
              mode: 'data',
            });
          }}
        />
      ) : null}

      {newDatabaseFor ? (
        <NewDatabaseDialog
          open
          connection={newDatabaseFor}
          onClose={() => setNewDatabaseFor(null)}
          onCreated={() => {
            if (newDatabaseFor) void loadDatabases(newDatabaseFor, true);
          }}
        />
      ) : null}
    </aside>
  );
}

function pickSchema(connection: Connection, list: string[]): string {
  const preferred = defaultSchemaFor(connection.driver, connection);
  if (preferred && list.includes(preferred)) return preferred;
  if (connection.driver === 'postgres' && list.includes('public')) return 'public';
  if (connection.driver === 'sqlserver' && list.includes('dbo')) return 'dbo';
  return list[0] ?? preferred;
}

function systemDatabase(driver: Connection['driver'], name: string): boolean {
  if (driver === 'mysql' || driver === 'mariadb') {
    return ['information_schema', 'mysql', 'performance_schema', 'sys'].includes(name.toLowerCase());
  }
  if (driver === 'postgres') {
    return ['postgres', 'template0', 'template1'].includes(name.toLowerCase());
  }
  if (driver === 'sqlserver') {
    return ['master', 'model', 'msdb', 'tempdb'].includes(name.toLowerCase());
  }
  if (driver === 'mongodb') {
    return ['admin', 'local', 'config'].includes(name.toLowerCase());
  }
  return false;
}

function LoadingRows({ depth, count = 2 }: { depth: number; count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <div className="tree-loading-row" style={{ paddingLeft: depth * 14 + 24 }} key={index}>
          <span className="skeleton skeleton-tree" />
        </div>
      ))}
    </>
  );
}
