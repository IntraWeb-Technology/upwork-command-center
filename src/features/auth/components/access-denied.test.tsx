// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AccessDenied } from './access-denied';

describe('AccessDenied', () => {
  it('announces the denial and renders the provided action', () => {
    render(<AccessDenied action={<button type='button'>Sign out</button>} />);

    expect(screen.getByRole('alert')).toHaveTextContent('not authorized');
    expect(screen.getByRole('heading', { level: 1, name: 'Access denied' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });
});
