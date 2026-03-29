import type { Meta, StoryObj } from '@storybook/svelte';
import LineChart from '../charts/LineChart.svelte';

const meta = {
  title: 'Charts/LineChart',
  component: LineChart,
  tags: ['autodocs'],
  argTypes: {
    height: { control: { type: 'number', min: 100, max: 500 } },
    showDots: { control: 'boolean' },
    fill: { control: 'boolean' },
  },
} satisfies Meta<LineChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    data: [
      { label: 'Mon', value: 120 },
      { label: 'Tue', value: 180 },
      { label: 'Wed', value: 150 },
      { label: 'Thu', value: 210 },
      { label: 'Fri', value: 190 },
      { label: 'Sat', value: 250 },
      { label: 'Sun', value: 220 },
    ],
    height: 200,
    showDots: true,
    fill: true,
  },
};

export const NoFill: Story = {
  args: {
    data: [
      { label: 'Q1', value: 3200 },
      { label: 'Q2', value: 4100 },
      { label: 'Q3', value: 3800 },
      { label: 'Q4', value: 5200 },
    ],
    height: 250,
    showDots: true,
    fill: false,
    color: '#10b981',
  },
};
