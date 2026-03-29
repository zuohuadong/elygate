import type { Meta, StoryObj } from '@storybook/svelte';
import PieChart from '../charts/PieChart.svelte';

const meta = {
  title: 'Charts/PieChart',
  component: PieChart,
  tags: ['autodocs'],
  argTypes: {
    size: { control: { type: 'number', min: 100, max: 400 } },
    donut: { control: { type: 'number', min: 0, max: 0.8, step: 0.1 } },
  },
} satisfies Meta<PieChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Donut: Story = {
  args: {
    data: [
      { label: 'Desktop', value: 580, color: '#6366f1' },
      { label: 'Mobile', value: 320, color: '#f59e0b' },
      { label: 'Tablet', value: 100, color: '#10b981' },
    ],
    size: 200,
    donut: 0.6,
  },
};

export const Pie: Story = {
  args: {
    data: [
      { label: 'Chrome', value: 64, color: '#4285f4' },
      { label: 'Safari', value: 19, color: '#5ac8fa' },
      { label: 'Firefox', value: 10, color: '#ff7139' },
      { label: 'Edge', value: 4, color: '#0078d7' },
      { label: 'Other', value: 3, color: '#a0a0a0' },
    ],
    size: 220,
    donut: 0,
  },
};
