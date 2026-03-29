import type { Meta, StoryObj } from '@storybook/svelte';
import BarChart from '../charts/BarChart.svelte';

const meta = {
  title: 'Charts/BarChart',
  component: BarChart,
  tags: ['autodocs'],
  argTypes: {
    height: { control: { type: 'number', min: 100, max: 500 } },
    showValues: { control: 'boolean' },
  },
} satisfies Meta<BarChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    data: [
      { label: 'Jan', value: 120 },
      { label: 'Feb', value: 180 },
      { label: 'Mar', value: 95 },
      { label: 'Apr', value: 210 },
      { label: 'May', value: 165 },
      { label: 'Jun', value: 245 },
    ],
    height: 200,
    showValues: true,
  },
};

export const CustomColors: Story = {
  args: {
    data: [
      { label: 'Users', value: 1200, color: '#6366f1' },
      { label: 'Orders', value: 850, color: '#f59e0b' },
      { label: 'Revenue', value: 2100, color: '#10b981' },
      { label: 'Returns', value: 120, color: '#ef4444' },
    ],
    height: 250,
    showValues: true,
  },
};
