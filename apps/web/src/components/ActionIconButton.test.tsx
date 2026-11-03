import { fireEvent, render, screen } from '@testing-library/react';
import { EditOutlined } from '@ant-design/icons';
import { ActionIconButton } from './ActionIconButton';

it('shows an accessible icon action with a hover tooltip and stops row navigation', async () => {
  const action = vi.fn();
  const navigate = vi.fn();
  render(<div onClick={navigate}><ActionIconButton label="Sửa" icon={<EditOutlined />} onClick={action} /></div>);
  const button = screen.getByRole('button', { name: 'Sửa' });
  expect(button.textContent).toBe('');
  fireEvent.mouseEnter(button);
  expect(await screen.findByRole('tooltip')).toHaveTextContent('Sửa');
  fireEvent.click(button);
  expect(action).toHaveBeenCalledTimes(1);
  expect(navigate).not.toHaveBeenCalled();
});
