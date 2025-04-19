import { useStore } from '@/client/store';
import { CaretRightOutlined, LoadingOutlined } from '@ant-design/icons';
import { Button, Space } from 'antd';
import { observer } from 'mobx-react-lite';
import { useAsyncFn } from 'react-use';

const Control = () => {
  const home = useStore('home');
  const setting = useStore('setting');

  const runGraphApi = useAsyncFn(home.runCurrentGraph.bind(home));

  return (
    <>
      <Space>
        <Button
          disabled={!home.currentGraphId}
          loading={runGraphApi[0].loading}
          onClick={() => {
            runGraphApi[1]({ graphId: home.currentGraphId! });
          }}
        >
          {home.graphState === 'RUNNING'
            ? setting.tr('Running')
            : setting.tr('Run')}
          {home.graphState === 'RUNNING' ? (
            <LoadingOutlined />
          ) : (
            <CaretRightOutlined />
          )}
        </Button>
      </Space>
    </>
  );
};

export default observer(Control);
