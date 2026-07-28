import type { CommandSpecInput } from '../types';

export const demoCommands = (): CommandSpecInput[] => [
      {
        id: 'demo.render-self',
        label: 'Render self-graph',
        event: 'demo.run-self',
        group: 'demo',
        hidden: true,
      },
      {
        id: 'demo.render-c4',
        label: 'Open checkout microservices architecture',
        event: 'demo.run-c4',
        group: 'demo',
      },
      {
        id: 'demo.render-math',
        label: 'Open radial expected-value map',
        event: 'demo.run-math',
        group: 'demo',
      },
      {
        id: 'demo.render-workflow',
        label: 'Open Jira issue workflow example',
        event: 'demo.run-workflow',
        group: 'demo',
      },
      {
        id: 'demo.render-flowchart',
        label: 'Open canonical flowchart example',
        event: 'demo.run-flowchart',
        group: 'demo',
      },
      {
        id: 'demo.render-mindmap',
        label: 'Open canonical mindmap example',
        event: 'demo.run-mindmap',
        group: 'demo',
      },
      {
        id: 'demo.render-game',
        label: 'Open vertical nested Game design map',
        event: 'demo.run-game',
        group: 'demo',
      },
      {
        id: 'demo.render-uml',
        label: 'Open UML class map example',
        event: 'demo.run-uml',
        group: 'demo',
      },
      {
        id: 'demo.render-outline',
        label: 'Open nested outline example',
        event: 'demo.run-outline',
        group: 'demo',
      },
      {
        id: 'demo.render-transformer',
        label: 'Open Transformer architecture example',
        event: 'demo.run-transformer',
        group: 'demo',
      },
      {
        id: 'demo.render-kimi-k2',
        label: 'Open Kimi K2 architecture example',
        event: 'demo.run-kimi-k2',
        group: 'demo',
      },
      {
        id: 'demo.render-agent-observability',
        label: 'Open multi-agent observability report example',
        event: 'demo.run-agent-observability',
        group: 'demo',
      },
    ];

