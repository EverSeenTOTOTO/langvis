/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom/vitest';
import SchemaField, { SchemaProperty } from '@/client/components/SchemaField';
import { Form } from 'antd';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// Mock window.matchMedia for antd responsive components
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  // Mock ResizeObserver for antd
  global.ResizeObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  }));
});

describe('SchemaField', () => {
  it('should render simple string field with correct name path', () => {
    const prop: SchemaProperty = {
      type: 'string',
      title: 'Name',
    };

    render(
      <Form>
        <SchemaField name="name" prop={prop} namePrefix={['config']} />
      </Form>,
    );

    const input = screen.getByRole('textbox');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('id', 'config_name');
  });

  it('should render nested object field with correct nested name path', () => {
    const prop: SchemaProperty = {
      type: 'object',
      title: 'Model',
      properties: {
        code: {
          type: 'string',
          title: 'Model Code',
          default: 'gpt-4',
        },
        temperature: {
          type: 'number',
          title: 'Temperature',
          default: 0.7,
        },
      },
    };

    render(
      <Form>
        <SchemaField name="model" prop={prop} namePrefix={['config']} />
      </Form>,
    );

    // Check that nested fields have correct paths (not character-split)
    const modelCodeInput = screen.getByRole('textbox');
    expect(modelCodeInput).toBeInTheDocument();
    // The id should be 'config_model_code', not 'config_m_o_d_e_l_code'
    expect(modelCodeInput).toHaveAttribute('id', 'config_model_code');

    // Check temperature number input
    const tempInput = screen.getByRole('spinbutton');
    expect(tempInput).toBeInTheDocument();
    expect(tempInput).toHaveAttribute('id', 'config_model_temperature');
  });

  it('should render deeply nested object field with correct name path', () => {
    const prop: SchemaProperty = {
      type: 'object',
      title: 'Level1',
      properties: {
        level2: {
          type: 'object',
          title: 'Level2',
          properties: {
            value: {
              type: 'string',
              title: 'Deep Value',
            },
          },
        },
      },
    };

    render(
      <Form>
        <SchemaField name="level1" prop={prop} />
      </Form>,
    );

    const deepInput = screen.getByRole('textbox');
    // Should be 'level1_level2_value', not character-split path
    expect(deepInput).toHaveAttribute('id', 'level1_level2_value');
  });

  it('should handle array name path correctly', () => {
    const prop: SchemaProperty = {
      type: 'object',
      title: 'Settings',
      properties: {
        enabled: {
          type: 'boolean',
          title: 'Enabled',
        },
      },
    };

    render(
      <Form>
        <SchemaField name={['settings', 'nested']} prop={prop} />
      </Form>,
    );

    // The boolean switch should have correct path
    const switchInput = screen.getByRole('switch');
    expect(switchInput).toBeInTheDocument();
    expect(switchInput).toHaveAttribute('id', 'settings_nested_enabled');
  });

  it('should produce correct form values when submitted', async () => {
    const user = userEvent.setup();
    const prop: SchemaProperty = {
      type: 'object',
      title: 'Model',
      properties: {
        code: {
          type: 'string',
          title: 'Code',
        },
        temperature: {
          type: 'number',
          title: 'Temperature',
        },
      },
    };

    let formValues: unknown = null;
    const onFinish = (values: unknown) => {
      formValues = values;
    };

    const TestForm = () => (
      <Form onFinish={onFinish}>
        <SchemaField name="model" prop={prop} namePrefix={['config']} />
        <button type="submit">Submit</button>
      </Form>
    );

    render(<TestForm />);

    // Fill in the form
    const codeInput = screen.getByRole('textbox');
    await user.type(codeInput, 'gpt-4');

    const tempInput = screen.getByRole('spinbutton');
    await user.type(tempInput, '0.5');

    // Submit the form
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    // Verify the form values have correct nested structure
    // Should be { config: { model: { code: 'gpt-4', temperature: 0.5 } } }
    // NOT the buggy character-split structure
    expect(formValues).toEqual({
      config: {
        model: {
          code: 'gpt-4',
          temperature: 0.5,
        },
      },
    });
  });
});
