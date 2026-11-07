import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Cable,
  Eye,
  EyeOff,
  FolderOpen,
  Loader2,
  PlugZap,
  Shield,
  ShieldCheck,
  Save,
} from 'lucide-react';
import { api } from '../lib/api';
import { CONNECTION_COLORS, CONNECTION_TEMPLATES, DRIVER_META, classNames, defaultSchemaFor } from '../lib/utils';
import { useAppStore } from '../store/appStore';
import { useAuthStore } from '../store/authStore';
import type { Connection, ConnectionInput, Driver, TestConnectionResult } from '../types';
import { DriverBadge, Modal, Spinner, Switch } from './ui';

interface FormState {
  name: string;
  driver: Driver;
  host: string;
  port: string;
  username: string;
  password: string;
  database: string;
  sslMode: string;
  sqlitePath: string;
  instance: string;
  oracleSid: string;
  oracleWallet: string;
  account: string;
  warehouse: string;
  role: string;
  defaultSchema: string;
  authSource: string;
  tenant: string;
  template: string;
  color: string;
  readOnly: boolean;
}

const EMPTY_FORM: FormState = {
  name: '',
  driver: 'mysql',
  host: '127.0.0.1',
  port: '3306',
  username: 'root',
  password: '',
  database: '',
  sslMode: 'disable',
  sqlitePath: '',
  instance: '',
  oracleSid: '',
  oracleWallet: '',
  account: '',
  warehouse: '',
  role: '',
  defaultSchema: '',
  authSource: '',
  tenant: '',
  template: 'custom',
  color: CONNECTION_COLORS[0],
  readOnly: false,
};

function defaultUsername(driver: Driver): string {
  if (driver === 'oracle') return 'system';
  if (driver === 'sqlserver') return 'sa';
  if (driver === 'snowflake') return 'navideck';
  if (driver === 'mongodb') return 'admin';
  if (driver === 'redis') return '';
  return 'root';
}

function fromConnection(connection?: Connection): FormState {
  if (!connection) return EMPTY_FORM;
  return {
    name: connection.name,
    driver: connection.driver,
    host: connection.host ?? '127.0.0.1',
    port: String(connection.port || DRIVER_META[connection.driver].defaultPort || ''),
    username: connection.username ?? '',
    password: '',
    database: connection.database ?? '',
    sslMode: connection.sslMode ?? 'disable',
    sqlitePath: connection.sqlitePath ?? '',
    instance: connection.instance ?? '',
    oracleSid: connection.oracleSid ?? '',
    oracleWallet: connection.oracleWallet ?? '',
    account: connection.account ?? '',
    warehouse: connection.warehouse ?? '',
    role: connection.role ?? '',
    defaultSchema: connection.defaultSchema ?? '',
    authSource: connection.authSource ?? '',
    tenant: connection.tenant ?? '',
    template: connection.template || 'custom',
    color: connection.color || CONNECTION_COLORS[0],
    readOnly: connection.readOnly,
  };
}

export function ConnectionDialog() {
  const dialog = useAppStore((state) => state.connectionDialog);
  const closeDialog = useAppStore((state) => state.closeConnectionDialog);
  const loadConnections = useAppStore((state) => state.loadConnections);
  const setConnected = useAppStore((state) => state.setConnectionConnected);
  const openQuery = useAppStore((state) => state.openQuery);
  const toast = useAppStore((state) => state.toast);
  const agentMode = useAppStore((state) => state.agentMode);
  const authUser = useAuthStore((state) => state.user);
  const authStatus = useAuthStore((state) => state.status);
  const isAdmin = authUser?.role === 'ADMIN' || authStatus?.authEnabled === false;
  const isNonAdmin = authStatus?.authEnabled === true && !isAdmin;

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const editing = dialog.connection;
  const isSqlite = form.driver === 'sqlite';
  const isOracle = form.driver === 'oracle';
  const isSqlServer = form.driver === 'sqlserver';
  const isSnowflake = form.driver === 'snowflake';
  const isMongo = form.driver === 'mongodb';
  const isRedis = form.driver === 'redis';
  const isChroma = form.driver === 'chroma';
  const templateGroups = useMemo(
    () => [...new Set(CONNECTION_TEMPLATES.map((template) => template.group))],
    [],
  );
  const selectedTemplate = CONNECTION_TEMPLATES.find((template) => template.id === form.template) ?? CONNECTION_TEMPLATES[0];
  const isEditingSqlite = editing?.driver === 'sqlite';
  const availableDrivers = (Object.keys(DRIVER_META) as Driver[]).filter(
    (driver) => isAdmin || driver !== 'sqlite' || isEditingSqlite,
  );

  useEffect(() => {
    if (!dialog.open) return;
    const next = fromConnection(dialog.connection);
    if (!dialog.connection && !isAdmin) next.host = '';
    setForm(next);
    setShowPassword(false);
    setSaving(false);
    setTesting(false);
    setTestResult(null);
    setError(null);
  }, [dialog.open, dialog.connection, isAdmin]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((state) => ({ ...state, [key]: value }));
  };

  const selectDriver = (driver: Driver) => {
    setForm((state) => {
      const sameDriver = driver === state.driver;
      return {
        ...state,
        driver,
        template: 'custom',
        port: String(DRIVER_META[driver].defaultPort || ''),
        host: driver === 'sqlite' ? '' : state.host || (isAdmin ? '127.0.0.1' : ''),
        username: driver === 'sqlite' || driver === 'chroma' ? '' : sameDriver ? state.username : defaultUsername(driver),
        database: driver === 'sqlite' || driver === 'redis' || driver === 'snowflake'
          ? ''
          : driver === 'chroma'
            ? state.database || 'default_database'
            : state.database,
        tenant: driver === 'chroma' ? state.tenant || 'default_tenant' : state.tenant,
        sslMode: sameDriver ? state.sslMode : 'disable',
        instance: sameDriver ? state.instance : '',
        oracleSid: sameDriver ? state.oracleSid : '',
        oracleWallet: sameDriver ? state.oracleWallet : '',
        authSource: sameDriver ? state.authSource : 'admin',
        defaultSchema: sameDriver ? state.defaultSchema : '',
      };
    });
  };

  const applyTemplate = (templateId: string) => {
    if (templateId === 'custom') {
      setForm((state) => ({ ...state, template: 'custom' }));
      return;
    }
    const template = CONNECTION_TEMPLATES.find((item) => item.id === templateId);
    if (!template) return;
    setForm((state) => {
      const keepUsername = state.username && state.username !== defaultUsername(state.driver);
      return {
        ...state,
        template: template.id,
        driver: template.driver,
        port: String(template.port),
        sslMode: template.sslMode,
        host: state.host || (isAdmin ? '127.0.0.1' : ''),
        username: keepUsername ? state.username : defaultUsername(template.driver),
        database: template.driver === 'oracle' || template.driver === 'snowflake' || template.driver === 'redis'
          ? ''
          : template.driver === 'chroma'
            ? state.database || 'default_database'
            : state.database,
        tenant: template.driver === 'chroma' ? state.tenant || 'default_tenant' : state.tenant,
        instance: '',
        oracleSid: '',
        oracleWallet: template.driver === 'oracle' ? state.oracleWallet : '',
        authSource: template.driver === 'mongodb' ? (state.authSource || 'admin') : '',
        defaultSchema: template.driver === 'snowflake' ? (state.defaultSchema || 'PUBLIC') : '',
      };
    });
  };

  const sslOptions = useMemo((): Array<[string, string]> => {
    if (form.driver === 'postgres') {
      return [
        ['disable', '禁用 SSL'],
        ['prefer', '优先使用 SSL'],
        ['require', '要求 SSL'],
        ['verify-ca', '验证 CA'],
        ['verify-full', '完整验证'],
      ];
    }
    if (isSqlServer) {
      return [
        ['disable', '禁用加密'],
        ['require', '加密（信任服务器证书）'],
        ['verify-full', '加密并验证证书'],
        ['strict', 'TDS 8 严格加密'],
      ];
    }
    if (isOracle) {
      return [
        ['disable', '禁用 SSL'],
        ['require', 'TCPS（不验证证书）'],
        ['verify-full', 'TCPS + 验证证书'],
      ];
    }
    if (isMongo || isRedis) {
      return [
        ['disable', '禁用 TLS'],
        ['require', '启用 TLS（不验证证书）'],
        ['verify-full', 'TLS + 验证证书'],
      ];
    }
    if (isSnowflake || isSqlite || isChroma) {
      return [];
    }
    return [
      ['disable', '禁用 SSL'],
      ['preferred', '优先使用 SSL'],
      ['require', '要求 SSL'],
      ['skip-verify', '跳过证书校验'],
    ];
  }, [form.driver, isChroma, isMongo, isOracle, isRedis, isSnowflake, isSqlServer, isSqlite]);

  const buildPayload = (withPassword: boolean): ConnectionInput => {
    const payload: ConnectionInput = {
      name: form.name.trim(),
      driver: form.driver,
      host: isSqlite || isSnowflake ? undefined : form.host.trim(),
      port: isSqlite || isSnowflake ? undefined : Number(form.port) || DRIVER_META[form.driver].defaultPort,
      username: isSqlite ? undefined : form.username.trim(),
      database: isSqlite ? 'main' : form.database.trim(),
      sslMode: isSqlite || isSnowflake ? undefined : form.sslMode,
      sqlitePath: isSqlite ? form.sqlitePath.trim() : undefined,
      instance: isSqlServer ? form.instance.trim() : undefined,
      oracleSid: isOracle ? form.oracleSid.trim() : undefined,
      oracleWallet: isOracle ? form.oracleWallet.trim() : undefined,
      account: isSnowflake ? form.account.trim() : undefined,
      warehouse: isSnowflake ? form.warehouse.trim() : undefined,
      role: isSnowflake ? form.role.trim() : undefined,
      defaultSchema: isSnowflake ? form.defaultSchema.trim() : undefined,
      authSource: isMongo ? form.authSource.trim() : undefined,
      tenant: isChroma ? form.tenant.trim() : undefined,
      template: form.template,
      color: form.color,
      readOnly: form.readOnly,
    };
    if (!isChroma) {
      if (withPassword && form.password !== '') payload.password = form.password;
      if ((!editing || form.password) && !isSqlite) payload.password = form.password;
    } else {
      payload.username = undefined;
      payload.password = undefined;
      payload.sslMode = undefined;
    }
    return payload;
  };

  const validate = (): string | null => {
    if (!form.name.trim()) return '请填写连接名称';
    if (isSqlite && !form.sqlitePath.trim()) return '请填写 SQLite 数据库文件路径';
    if (!isSqlite && !isSnowflake && !form.host.trim()) return '请填写主机地址';
    if (!isSqlite && !isSnowflake && (!form.port || Number(form.port) <= 0)) return '请填写有效端口';
    if (isSnowflake) {
      if (!form.account.trim()) return '请填写 Snowflake 账户标识';
      if (!form.username.trim()) return '请填写 Snowflake 用户名';
    }
    if (isOracle && !form.username.trim()) return '请填写 Oracle 用户名';
    if (isOracle && !form.database.trim() && !form.oracleSid.trim()) {
      return '请填写 Oracle 服务名（Service Name）或 SID';
    }
    if (isRedis && form.database.trim() !== '' && (Number(form.database) < 0 || Number(form.database) > 15)) {
      return 'Redis DB 编号应在 0-15 之间';
    }
    if (isChroma && !form.tenant.trim()) return '请填写租户名（Tenant）';
    if (isChroma && !form.database.trim()) return '请填写数据库名（Database）';
    return null;
  };

  const handleTest = async () => {
    const validation = validate();
    if (validation) {
      setError(validation);
      toast('warning', '请检查连接参数', validation);
      return;
    }
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      const result = await api.testConnection({
        ...buildPayload(true),
        id: editing?.id,
      });
      setTestResult(result);
      if (result.ok) {
        toast('success', '测试连接成功', `${result.server || '数据库'} · ${result.latencyMs} ms`);
      } else {
        toast('error', '测试连接失败', result.message || '请检查连接参数');
      }
    } catch (testError) {
      const message = testError instanceof Error ? testError.message : String(testError);
      setTestResult({
        ok: false,
        latencyMs: 0,
        message,
      });
      toast('error', '测试连接失败', message);
    } finally {
      setTesting(false);
    }
  };

  const save = async (connectAfter: boolean) => {
    const validation = validate();
    if (validation) {
      setError(validation);
      toast('warning', '请检查连接参数', validation);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = buildPayload(true);
      const saved = editing ? await api.updateConnection(editing.id, payload) : await api.createConnection(payload);
      await loadConnections();
      toast('success', editing ? '连接已更新' : '连接已创建', saved.name);
      if (connectAfter) {
        try {
          await api.connect(saved.id);
          setConnected(saved.id, true);
          await loadConnections();
          const database = saved.database || (saved.driver === 'sqlite' ? 'main' : '');
          openQuery(saved, {
            database,
            schema: defaultSchemaFor(saved.driver, saved, database),
          });
          toast('success', '连接成功', `${saved.name} 已连接`);
        } catch (connectError) {
          const message = connectError instanceof Error ? connectError.message : String(connectError);
          setConnected(saved.id, false);
          setError(`连接已保存，但连接失败：${message}`);
          toast('error', '连接失败', message);
          return;
        }
      }
      closeDialog();
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : String(saveError);
      setError(message);
      toast('error', editing ? '更新连接失败' : '创建连接失败', message);
    } finally {
      setSaving(false);
    }
  };

  const renderTestResult = () => {
    if (!testResult) return null;
    return (
      <div className={classNames('test-result', testResult.ok ? 'success' : 'error')}>
        <span className="test-result-icon">
          {testResult.ok ? <ShieldCheck size={17} /> : <PlugZap size={17} />}
        </span>
        <div>
          <strong>{testResult.ok ? '连接成功' : '连接失败'}</strong>
          <span>
            {testResult.ok
              ? `${testResult.server || ''} · 延迟 ${testResult.latencyMs} ms`
              : testResult.message || '请检查连接参数'}
          </span>
        </div>
      </div>
    );
  };

  return (
    <Modal
      open={dialog.open}
      onClose={closeDialog}
      title={editing ? '编辑连接' : '新建连接'}
      subtitle="连接参数仅保存在本机，密码使用 AES-GCM 加密存储。"
      width={720}
      footer={
        <>
          <button type="button" className="btn" onClick={handleTest} disabled={testing || saving}>
            {testing ? <Spinner /> : <PlugZap size={14} />}
            测试连接
          </button>
          <div className="modal-footer-spacer" />
          <button type="button" className="btn" onClick={closeDialog} disabled={saving}>
            取消
          </button>
          <button type="button" className="btn" onClick={() => save(false)} disabled={saving}>
            <Save size={14} />
            保存
          </button>
          <button type="button" className="btn btn-primary" onClick={() => save(true)} disabled={saving}>
            {saving ? <Spinner /> : <PlugZap size={14} />}
            保存并连接
          </button>
        </>
      }
    >
      <div className="connection-form">
        <div className="template-bar">
          <div className="template-bar-text">
            <strong>快速模板</strong>
            <small>
              云厂商、兼容数据库会预填引擎、端口与 SSL；实际仍使用对应数据库驱动，不会调用云厂商 API。
              {selectedTemplate.id !== 'custom' ? ` · ${selectedTemplate.description}` : ''}
            </small>
          </div>
          <select
            className="select template-select"
            value={CONNECTION_TEMPLATES.some((item) => item.id === form.template) ? form.template : 'custom'}
            onChange={(event) => applyTemplate(event.target.value)}
            title="选择连接模板"
          >
            {templateGroups.map((group) => (
              <optgroup key={group} label={group}>
                {CONNECTION_TEMPLATES.filter((item) => item.group === group).map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div className="driver-picker">
          {availableDrivers.map((driver) => {
            const meta = DRIVER_META[driver];
            return (
              <button
                type="button"
                key={driver}
                className={classNames('driver-option', form.driver === driver && 'active')}
                onClick={() => selectDriver(driver)}
                style={{ '--driver-color': meta.color } as CSSProperties}
              >
                <DriverBadge driver={driver} size="lg" />
                <span>
                  <strong>{meta.label}</strong>
                  <small>{meta.description}</small>
                </span>
                <span className="driver-check">{form.driver === driver ? '✓' : ''}</span>
              </button>
            );
          })}
        </div>

        {agentMode ? (
          <div className="connection-security-note agent-local-note">
            <Cable size={15} />
            <span>
              本地 Agent 模式：可以连接 localhost、127.0.0.1 与内网数据库；连接配置与密码保存在你电脑上的 Agent，不上传云端。
            </span>
          </div>
        ) : isNonAdmin ? (
          <div className="connection-security-note">
            <Shield size={15} />
            <span>
              当前为普通用户：只能连接公网数据库，禁止连接本机/内网地址；SQLite 仅限个人沙箱，不能读取服务器文件。
            </span>
          </div>
        ) : null}

        <div className="form-grid">
          <label className="field field-span-2">
            <span>连接名称</span>
            <input
              className="input"
              value={form.name}
              onChange={(event) => update('name', event.target.value)}
              placeholder={form.driver === 'sqlite' ? '我的本地数据库' : `生产环境 · ${DRIVER_META[form.driver].label}`}
              autoFocus
            />
          </label>

          {isSqlite ? (
            <label className="field field-span-2">
              <span>数据库文件</span>
              <div className="input-with-icon">
                <FolderOpen size={15} />
                <input
                  className="input"
                  value={form.sqlitePath}
                  onChange={(event) => update('sqlitePath', event.target.value)}
                  placeholder={isNonAdmin ? '仅限个人沙箱内的相对路径' : '例如 demo.db 或 D:\\data\\app.sqlite3'}
                />
              </div>
              <small className="field-hint">
                {isNonAdmin
                  ? '普通用户只能访问自己的个人 SQLite 沙箱，不能读取服务器上的其他文件。'
                  : '相对路径会相对于服务端数据目录解析；文件不存在时会自动创建。'}
              </small>
            </label>
          ) : (
            <>
              {isSnowflake ? (
                <label className="field field-span-2">
                  <span>账户标识（Account Identifier）</span>
                  <input
                    className="input"
                    value={form.account}
                    onChange={(event) => update('account', event.target.value)}
                    placeholder="例如 xy12345.us-east-1 或 org-account"
                  />
                  <small className="field-hint">Snowflake 账户定位符，不是主机地址；例如 ab12345.ap-southeast-1。</small>
                </label>
              ) : (
                <>
                  <label className="field field-span-host">
                    <span>主机</span>
                    <input
                      className="input"
                      value={form.host}
                      onChange={(event) => update('host', event.target.value)}
                      placeholder={isAdmin ? '127.0.0.1' : 'db.example.com'}
                    />
                  </label>
                  <label className="field">
                    <span>端口</span>
                    <input
                      className="input"
                      type="number"
                      value={form.port}
                      onChange={(event) => update('port', event.target.value)}
                      placeholder={String(DRIVER_META[form.driver].defaultPort)}
                    />
                  </label>
                </>
              )}
              {isChroma ? (
                <label className="field">
                  <span>租户名（Tenant）</span>
                  <input
                    className="input"
                    value={form.tenant}
                    onChange={(event) => update('tenant', event.target.value)}
                    placeholder="default_tenant"
                  />
                  <small className="field-hint">Chroma 默认 {`default_tenant`}，通常无需修改。</small>
                </label>
              ) : null}
              {isSqlServer ? (
                <label className="field">
                  <span>实例名（可选）</span>
                  <input
                    className="input"
                    value={form.instance}
                    onChange={(event) => update('instance', event.target.value)}
                    placeholder="例如 SQLEXPRESS"
                  />
                  <small className="field-hint">命名实例可填写；使用固定端口时留空。</small>
                </label>
              ) : null}
              {isChroma ? null : (
                <>
                  <label className="field">
                    <span>用户名</span>
                    <input
                      className="input"
                      value={form.username}
                      onChange={(event) => update('username', event.target.value)}
                      placeholder={defaultUsername(form.driver)}
                      autoComplete="username"
                    />
                  </label>
                  <label className="field">
                    <span>密码</span>
                    <div className="input-with-action">
                      <input
                        className="input"
                        type={showPassword ? 'text' : 'password'}
                        value={form.password}
                        onChange={(event) => update('password', event.target.value)}
                        placeholder={editing ? '留空则保持已保存密码' : '输入密码'}
                        autoComplete="current-password"
                      />
                      <button
                        type="button"
                        className="input-action"
                        onClick={() => setShowPassword((value) => !value)}
                        title={showPassword ? '隐藏密码' : '显示密码'}
                      >
                        {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                  </label>
                </>
              )}
              <label className="field">
                <span>
                  {isOracle ? '服务名（Service Name）'
                    : isSnowflake ? '数据库（可选）'
                      : isMongo ? '默认数据库（可选）'
                        : isRedis ? '默认 DB（0-15）'
                          : isChroma ? '数据库名（Database）'
                            : '默认数据库'}
                </span>
                <input
                  className="input"
                  value={form.database}
                  onChange={(event) => update('database', event.target.value)}
                  placeholder={
                    isOracle ? '例如 ORCLPDB1 或 xxx_high'
                      : isSqlServer ? '例如 master'
                        : isRedis ? '0'
                          : isMongo ? '例如 admin'
                            : isChroma ? 'default_database'
                              : '可选'
                  }
                />
                {isSqlServer ? <small className="field-hint">可留空，连接后再在对象树中选择数据库。</small> : null}
                {isRedis ? <small className="field-hint">每个 Redis 连接包含多个 DB，展开连接后可切换 DB 0-15。</small> : null}
                {isChroma ? <small className="field-hint">Chroma 默认数据库为 default_database；集合在该数据库下创建。</small> : null}
              </label>
              {isOracle ? (
                <label className="field">
                  <span>SID（可选，优先于服务名）</span>
                  <input
                    className="input"
                    value={form.oracleSid}
                    onChange={(event) => update('oracleSid', event.target.value)}
                    placeholder="例如 ORCL"
                  />
                </label>
              ) : null}
              {isSnowflake ? (
                <>
                  <label className="field">
                    <span>默认 Schema</span>
                    <input
                      className="input"
                      value={form.defaultSchema}
                      onChange={(event) => update('defaultSchema', event.target.value)}
                      placeholder="PUBLIC"
                    />
                  </label>
                  <label className="field">
                    <span>Warehouse（可选）</span>
                    <input
                      className="input"
                      value={form.warehouse}
                      onChange={(event) => update('warehouse', event.target.value)}
                      placeholder="例如 COMPUTE_WH"
                    />
                  </label>
                  <label className="field">
                    <span>Role（可选）</span>
                    <input
                      className="input"
                      value={form.role}
                      onChange={(event) => update('role', event.target.value)}
                      placeholder="例如 SYSADMIN"
                    />
                  </label>
                </>
              ) : null}
              {isMongo ? (
                <label className="field">
                  <span>Auth Source</span>
                  <input
                    className="input"
                    value={form.authSource}
                    onChange={(event) => update('authSource', event.target.value)}
                    placeholder="admin"
                  />
                </label>
              ) : null}
              {sslOptions.length > 0 ? (
                <label className="field">
                  <span>SSL / TLS 模式</span>
                  <select
                    className="select"
                    value={form.sslMode}
                    onChange={(event) => update('sslMode', event.target.value)}
                  >
                    {sslOptions.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {isOracle && isAdmin ? (
                <label className="field field-span-2">
                  <span>Wallet 目录（Oracle Cloud 可选）</span>
                  <input
                    className="input"
                    value={form.oracleWallet}
                    onChange={(event) => update('oracleWallet', event.target.value)}
                    placeholder="例如 C:\oracle\wallet 或 /opt/oracle/wallet"
                  />
                  <small className="field-hint">
                    Autonomous Database 等 TCPS 连接可填写服务端可访问的 Wallet 目录；路径不存在时连接会失败。
                  </small>
                </label>
              ) : isOracle ? (
                <div className="design-empty field-span-2">
                  <Shield size={15} /> 普通用户不能使用服务器本地 Oracle Wallet；如需 TCPS/Wallet，请联系管理员。
                </div>
              ) : null}
            </>
          )}

          <div className="field field-span-2 color-field">
            <span>标识颜色</span>
            <div className="color-swatches">
              {CONNECTION_COLORS.map((color) => (
                <button
                  type="button"
                  key={color}
                  className={classNames('color-swatch', form.color === color && 'active')}
                  style={{ backgroundColor: color }}
                  onClick={() => update('color', color)}
                  aria-label={color}
                />
              ))}
            </div>
          </div>

          <div className="field field-span-2 options-row">
            <div>
              <span className="options-title">只读连接</span>
              <small className="field-hint">阻止所有写操作与结构变更，适合生产只读账号。</small>
            </div>
            <Switch checked={form.readOnly} onChange={(value) => update('readOnly', value)} />
          </div>
        </div>

        {error ? <div className="form-error">{error}</div> : null}
        {renderTestResult()}
        {testing ? (
          <div className="test-loading">
            <Loader2 size={14} className="spin" /> 正在测试连接...
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
