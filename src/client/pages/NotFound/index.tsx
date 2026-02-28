import { Button, Result } from 'antd';
import { observer } from 'mobx-react-lite';
import { useNavigate } from 'react-router';
import { useStore } from '@/client/store';

const NotFound: React.FC = () => {
  const navigate = useNavigate();
  const settingStore = useStore('setting');

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        backgroundColor: settingStore.mode === 'dark' ? '#141414' : '#fff',
      }}
    >
      <Result
        status="404"
        title="404"
        subTitle="Sorry, the page you visited does not exist."
        extra={
          <Button type="primary" onClick={() => navigate('/')}>
            Back Home
          </Button>
        }
      />
    </div>
  );
};

export default observer(NotFound);
