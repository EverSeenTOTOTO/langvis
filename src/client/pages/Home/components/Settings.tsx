import { SUPPORTED_LOCALES } from '@/client/hooks/useI18n';
import { useStore } from '@/client/store';
import { MoonOutlined, SettingOutlined, SunOutlined } from '@ant-design/icons';
import { Button, Form, Popover, Select, Switch } from 'antd';
import { observer } from 'mobx-react-lite';

const Settings = () => {
  const setting = useStore('setting');

  return (
    <Popover
      placement="bottomRight"
      trigger="click"
      content={
        <div className="setting-content">
          <Form.Item
            label={setting.tr('Theme')}
            labelCol={{ flex: '1 1 60px' }}
            labelAlign="left"
          >
            <Switch
              unCheckedChildren={<SunOutlined />}
              checkedChildren={<MoonOutlined />}
              checked={setting.mode === 'dark'}
              onChange={() => setting.toggleMode()}
            />
          </Form.Item>
          <Form.Item
            label={setting.tr('Language')}
            labelCol={{ flex: '1 1 60px' }}
            labelAlign="left"
          >
            <Select
              value={setting.lang}
              onChange={value => setting.setLang(value)}
              options={Object.keys(SUPPORTED_LOCALES).map(key => ({
                label: SUPPORTED_LOCALES[key as 'zh_CN'],
                value: key,
              }))}
            />
          </Form.Item>
        </div>
      }
    >
      <Button type="text" icon={<SettingOutlined />} />
    </Popover>
  );
};

export default observer(Settings);
