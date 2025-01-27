import { useStore } from '@/client/store';
import { Select, SelectProps } from 'antd';
import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';

const GraphSelectNode = (props: SelectProps) => {
  const home = useStore('home');

  useEffect(() => {
    home.fetchAvailableGraphs();
  }, []);

  return (
    <Select
      loading={home.loading}
      placeholder="请选择图"
      fieldNames={{
        label: 'name',
        value: 'id',
      }}
      value={home.currentGraphId}
      options={home.availableGraphs}
      onChange={val => home.toggleGraph(val)}
      {...props}
    />
  );
};

export default observer(GraphSelectNode);
