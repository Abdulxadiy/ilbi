import React from 'react';
import Svg, { ClipPath, Defs, G, LinearGradient, Path, Stop } from 'react-native-svg';
import { useTheme } from '../../theme/ThemeContext';

interface IlbiLogoProps {
  height?: number;
  width?: number;
  monochromeColor?: string;
}

export const IlbiLogo: React.FC<IlbiLogoProps> = ({ height = 26, width, monochromeColor }) => {
  const { isDark, colors } = useTheme();
  const letterColor = monochromeColor || (isDark ? colors.text : '#141820');

  // Aspect ratio is 610 / 280 = ~2.178
  const calculatedWidth = width || Math.round(height * (610 / 280));

  return (
    <Svg width={calculatedWidth} height={height} viewBox="0 0 610 280">
      <Defs>
        <LinearGradient id="ilbi_full_blue" x1="90" y1="5" x2="165" y2="266" gradientUnits="userSpaceOnUse">
          <Stop stopColor="#0095ff" />
          <Stop offset="0.43" stopColor="#006bff" />
          <Stop offset="1" stopColor="#0049ff" />
        </LinearGradient>
        <ClipPath id="ilbi_full_ribbon_clip">
          <Path d="M90 5 C120 5 138 25 138 48 V187 C138 212 154 228 177 228 C190 228 202 220 212 210 C193 238 166 258 142 266 C109 252 90 229 90 198 Z" />
        </ClipPath>
      </Defs>

      {/* Mark letterforms */}
      <G fill={letterColor}>
        <Path d="M74 63 A27 27 0 1 1 20 63 A27 27 0 1 1 74 63 Z" />
        <Path d="M37 99 H72 V255 C41 252 22 233 22 207 V116 C22 106 27 99 37 99 Z" />
        <Path d="M151 99 H171 C222 99 258 136 258 182 C258 232 221 270 173 270 C151 270 133 264 119 255 L150 219 C157 223 165 225 173 225 C197 225 214 206 214 182 C214 161 196 144 174 144 H151 Z" />
      </G>

      {/* Blue ribbon */}
      <Path
        d="M90 5 C120 5 138 25 138 48 V187 C138 212 154 228 177 228 C190 228 202 220 212 210 C193 238 166 258 142 266 C109 252 90 229 90 198 Z"
        fill="url(#ilbi_full_blue)"
      />
      <Path
        d="M90 5 C120 5 138 25 138 48 V235 C117 233 101 225 90 215 Z"
        fill="#006bff"
        clipPath="url(#ilbi_full_ribbon_clip)"
      />
      <Path
        d="M90 214 C111 233 151 243 177 228 C190 228 202 220 212 210 C193 238 166 258 142 266 C117 255 98 237 90 214 Z"
        fill="#0055ff"
      />

      {/* Lowercase wordmark: ilbi.uz */}
      <G transform="translate(310, 103)">
        {/* i */}
        <Path d="M19 9 A9 9 0 1 1 1 9 A9 9 0 1 1 19 9 Z M2 25 H18 V73 H2 Z" fill={letterColor} fillRule="evenodd" />
        {/* l */}
        <Path d="M0 0 H17 V73 H0 Z" transform="translate(26, 0)" fill={letterColor} fillRule="evenodd" />
        {/* b */}
        <Path
          d="M0 0 H17 V29 C22 24 28 23 34 23 C49 23 59 34 59 49 C59 64 49 75 35 75 C27 75 21 72 17 67 V73 H0 Z M17 49 C17 57 22 62 29 62 C37 62 42 56 42 49 C42 41 37 36 29 36 C22 36 17 41 17 49 Z"
          transform="translate(51, 0)"
          fill={letterColor}
          fillRule="evenodd"
        />
        {/* i */}
        <Path d="M19 9 A9 9 0 1 1 1 9 A9 9 0 1 1 19 9 Z M2 25 H18 V73 H2 Z" transform="translate(117, 0)" fill={letterColor} fillRule="evenodd" />
        {/* blue dot */}
        <Path d="M19 65 A9.5 9.5 0 1 1 0 65 A9.5 9.5 0 1 1 19 65 Z" transform="translate(145, 0)" fill="#006bff" fillRule="evenodd" />
        {/* u */}
        <Path d="M0 25 H16 V52 C16 59 19 62 25 62 C31 62 35 58 35 51 V25 H51 V73 H35 V67 C31 72 25 75 18 75 C6 75 0 67 0 54 Z" transform="translate(170, 0)" fill={letterColor} fillRule="evenodd" />
        {/* z */}
        <Path d="M0 25 H44 V38 L20 59 H44 V73 H0 V60 L24 39 H0 Z" transform="translate(228, 0)" fill={letterColor} fillRule="evenodd" />
      </G>
    </Svg>
  );
};
