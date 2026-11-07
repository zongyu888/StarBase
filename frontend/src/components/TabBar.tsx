import { useEffect, useRef } from 'react';
import { Boxes, Eye, Layers3, Plus, Sparkles, Table2, Terminal, X } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { classNames } from '../lib/utils';
import { startNewQuery } from '../lib/actions';

export function TabBar() {
  const tabs = useAppStore((state) => state.tabs);
  const activeTabId = useAppStore((state) => state.activeTabId);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const closeTab = useAppStore((state) => state.closeTab);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = scrollRef.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(activeTabId)}"]`);
    element?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeTabId]);

  return (
    <div className="tabbar">
      <div className="tab-scroll" ref={scrollRef}>
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          const Icon = tab.kind === 'welcome' ? Sparkles : tab.kind === 'query' ? Terminal : tab.kind === 'redis' ? Boxes : tab.kind === 'chroma' ? Layers3 : tab.kind === 'table' && tab.objectType === 'view' ? Eye : Table2;
          return (
            <div
              key={tab.id}
              data-tab-id={tab.id}
              className={classNames('editor-tab', active && 'active')}
              onClick={() => setActiveTab(tab.id)}
              onAuxClick={(event) => {
                if (event.button === 1 && tab.kind !== 'welcome') {
                  event.preventDefault();
                  closeTab(tab.id);
                }
              }}
              title={tab.kind === 'welcome' ? '开始' : tab.kind === 'table' ? `${tab.database}.${tab.schema}.${tab.table}` : tab.title}
            >
              <span className={classNames('tab-icon', `tab-icon-${tab.kind}`)}>
                <Icon size={13} />
              </span>
              <span className="tab-title">{tab.title}</span>
              {tab.kind !== 'welcome' ? (
                <button
                  type="button"
                  className="tab-close"
                  onClick={(event) => {
                    event.stopPropagation();
                    closeTab(tab.id);
                  }}
                  aria-label="关闭标签"
                >
                  <X size={12} />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      <button type="button" className="tab-add" onClick={startNewQuery} title="新建查询">
        <Plus size={15} />
      </button>
      <div className="tabbar-fill" />
    </div>
  );
}
