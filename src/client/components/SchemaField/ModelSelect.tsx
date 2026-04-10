import { useAsyncFn } from 'react-use';
import { TreeSelect } from 'antd';
import React, { useEffect, useMemo } from 'react';
import { useStore } from '@/client/store';
import type { GroupedModels } from '@/shared/types/provider';

interface ModelSelectProps {
  value?: string;
  onChange?: (value: string) => void;
  modelType?: string;
  placeholder?: string;
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
  modelType = 'chat',
  placeholder,
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

  return (
    <TreeSelect
      showSearch={{
        treeNodeFilterProp: 'title',
      }}
      treeData={treeData}
      value={value}
      onChange={onChange}
      placeholder={placeholder || 'Select a model'}
      loading={state.loading}
      allowClear
      treeDefaultExpandAll
      style={{ width: '100%' }}
    />
  );
};

export default ModelSelect;
