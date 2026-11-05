// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import HospitalPublish from '../views/HospitalPublish';

const wallet = vi.hoisted(() => ({ address: undefined as string | undefined }));
vi.mock('wagmi', () => ({
  useConnection: () => wallet,
  useConnectors: () => [{}],
  useConnect: () => ({ mutate: vi.fn(), isPending: false }),
  useDisconnect: () => ({ mutate: vi.fn() }),
}));
afterEach(cleanup);

it('requires connection, registers a mock profile, previews a file and resets on wallet change', async () => {
  const { rerender } = render(<HospitalPublish />);
  expect(screen.getByText('Connect your wallet above')).toBeTruthy();
  wallet.address = '0x1111111111111111111111111111111111111111';
  rerender(<HospitalPublish />);
  await screen.findByLabelText('Hospital name');
  fireEvent.change(screen.getByLabelText('Hospital name'), { target: { value: 'Demo Hospital' } });
  fireEvent.change(screen.getByLabelText('Institution license / accreditation code'), { target: { value: 'DEMO-123' } });
  fireEvent.click(screen.getByText('Register Hospital Profile'));
  const input = await screen.findByLabelText('Clinical dataset');
  const file = new File(['age,diagnosis\n20,private\n40,secret'], 'demo.csv', { type: 'text/csv' });
  Object.defineProperty(file, 'text', { value: async () => 'age,diagnosis\n20,private\n40,secret' });
  fireEvent.change(input, { target: { files: [file] } });
  await screen.findByRole('table');
  expect(screen.getAllByRole('row')).toHaveLength(11);
  expect(screen.queryByText('private')).toBeNull();
  expect((screen.getByText('Encrypt & Publish to Swarm (ACT Enabled)') as HTMLButtonElement).disabled).toBe(true);
  wallet.address = '0x2222222222222222222222222222222222222222';
  rerender(<HospitalPublish />);
  await waitFor(() => expect(screen.queryByRole('table')).toBeNull());
  await screen.findByLabelText('Hospital name');
});
