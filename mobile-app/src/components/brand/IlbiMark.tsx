import React from 'react';
import Svg, { ClipPath, Defs, G, LinearGradient, Path, Stop } from 'react-native-svg';
import { useTheme } from '../../theme/ThemeContext';

interface IlbiMarkProps {
  size?: number;
  monochromeColor?: string; // Optional override for the dark letterforms
}

export const IlbiMark: React.FC<IlbiMarkProps> = ({ size = 32, monochromeColor }) => {
  const { isDark, colors } = useTheme();
  const letterColor = monochromeColor || (isDark ? colors.text : '#141820');

  return (
    <Svg width={size} height={size} viewBox="0 0 280 280">
      <Defs>
        <LinearGradient id="ilbi_blue_grad" x1="90" y1="5" x2="165" y2="266" gradientUnits="userSpaceOnUse">
          <Stop stopColor="#0095ff" />
          <Stop offset="0.43" stopColor="#006bff" />
          <Stop offset="1" stopColor="#0049ff" />
        </LinearGradient>
        <ClipPath id="ilbi_ribbon_clip">
          <Path d="M90 5 C120 5 138 25 138 48 V187 C138 212 154 228 177 228 C190 228 202 220 212 210 C193 238 166 258 142 266 C109 252 90 229 90 198 Z" />
        </ClipPath>
      </Defs>

      {/* Letterforms 'i' and 'b' back curves */}
      <G fill={letterColor}>
        <Path d="M74 63 A27 27 0 1 1 20 63 A27 27 0 1 1 74 63 Z" />
        <Path d="M37 99 H72 V255 C41 252 22 233 22 207 V116 C22 106 27 99 37 99 Z" />
        <Path d="M151 99 H171 C222 99 258 136 258 182 C258 232 221 270 173 270 C151 270 133 264 119 255 L150 219 C157 223 165 225 173 225 C197 225 214 206 214 182 C214 161 196 144 174 144 H151 Z" />
      </G>

      {/* Signature Blue Ribbon */}
      <Path
        d="M90 5 C120 5 138 25 138 48 V187 C138 212 154 228 177 228 C190 228 202 220 212 210 C193 238 166 258 142 266 C109 252 90 229 90 198 Z"
        fill="url(#ilbi_blue_grad)"
      />
      <Path
        d="M90 5 C120 5 138 25 138 48 V235 C117 233 101 225 90 215 Z"
        fill="#006bff"
        clipPath="url(#ilbi_ribbon_clip)"
      />
      <Path
        d="M90 214 C111 233 151 243 177 228 C190 228 202 220 212 210 C193 238 166 258 142 266 C117 255 98 237 90 214 Z"
        fill="#0055ff"
      />
    </Svg>
  );
};
