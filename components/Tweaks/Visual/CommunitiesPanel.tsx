import { StackDivider, VStack } from '@chakra-ui/react'
import React from 'react'
import { initialColoring } from '../../config'
import { EnableSection } from '../EnableSection'
import { SliderWithInfo } from '../SliderWithInfo'

export interface CommunitiesPanelProps {
  coloring: typeof initialColoring
  setColoring: any
}

export const CommunitiesPanel = (props: CommunitiesPanelProps) => {
  const { coloring, setColoring } = props
  const setColoringValue = (key: string, value: number | boolean) =>
    setColoring((curr: typeof initialColoring) => ({ ...curr, [key]: value }))
  return (
    <VStack
      spacing={2}
      justifyContent="flex-start"
      divider={<StackDivider borderColor="gray.400" />}
      align="stretch"
      color="gray.800"
    >
      <EnableSection
        label="Background zones"
        infoText="Draw a colored background zone behind each community. Only applies when graph coloring is set to communities."
        value={coloring.communityZones}
        onChange={() => setColoringValue('communityZones', !coloring.communityZones)}
      >
        <SliderWithInfo
          label="Zone opacity"
          value={coloring.zoneOpacity}
          min={0.025}
          max={0.5}
          step={0.025}
          onChange={(value) => setColoringValue('zoneOpacity', value)}
        />
      </EnableSection>
      <EnableSection
        label="Community labels"
        infoText="Show a generated name for each community. Only applies when graph coloring is set to communities."
        value={coloring.communityLabels}
        onChange={() => setColoringValue('communityLabels', !coloring.communityLabels)}
      >
        <SliderWithInfo
          label="Label font size"
          value={coloring.communityLabelFontSize}
          min={12}
          max={150}
          step={1}
          onChange={(value) => setColoringValue('communityLabelFontSize', value)}
        />
      </EnableSection>
    </VStack>
  )
}
