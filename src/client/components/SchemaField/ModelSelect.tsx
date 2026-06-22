import { useAsyncFn } from 'react-use';
import { TreeSelect } from 'antd';
import React, { useEffect, useMemo } from 'react';
import { useStore } from '@/client/store';
import type { GroupedModels } from '@/shared/types/provider';

interface ModelSelectProps {
  value?: string;
  onChange?: (value: string) => void;
  /**
   * 选中/清空模型时回调整条模型对象（含 multimodal 等元信息）。
   * ModelSelect 只负责「从已拉取的列表里找出选中的模型并报上来」，
   * 不关心自己在表单里的 name 路径——把元信息写到哪个兄弟字段，
   * 由上层（知道 name 的 SchemaField）决定。见 SchemaField 的 model-select 分支。
   */
  onModelSelect?: (model: GroupedModels['models'][number] | undefined) => void;
  modelType?: string;
  placeholder?: string;
  disabled?: boolean;
}

function groupToTreeData(groups: GroupedModels[]) {
  return groups.map(g => ({
    value: g.providerId,
    title: g.providerName,
    selectable: false,
    children: g.models.map(m => ({
      value: m.id,
      title: (
        <span>
          {m.multimodal && <span style={{ marginRight: 4 }}>&#x1F5BC;</span>}
          {m.name}
        </span>
      ),
    })),
  }));
}

const ModelSelect: React.FC<ModelSelectProps> = ({
  value,
  onChange,
  onModelSelect,
  modelType = 'chat',
  placeholder,
  disabled,
}) => {
  const modelStore = useStore('model');
  const [state, fetch] = useAsyncFn(modelStore.getModels.bind(modelStore));

  useEffect(() => {
    fetch({ type: modelType });
  }, [fetch, modelType]);

  const treeData = useMemo(
    () => groupToTreeData(state.value ?? []),
    [state.value],
  );

  const findModel = (id: string) =>
    ((state.value as GroupedModels[] | undefined) ?? [])
      .flatMap(g => g.models)
      .find(m => m.id === id);

  return (
    <TreeSelect
      showSearch={{
        treeNodeFilterProp: 'title',
      }}
      treeData={treeData}
      value={value}
      onChange={id => {
        onChange?.(id);
        onModelSelect?.(id == null ? undefined : findModel(id));
      }}
      placeholder={placeholder || 'Select a model'}
      loading={state.loading}
      disabled={disabled}
      allowClear
      treeDefaultExpandAll
      style={{ width: '100%' }}
    />
  );
};

export default ModelSelect;
