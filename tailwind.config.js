module.exports = {
  content: [
    './views/**/*.ejs',
    './src/views/**/*.ejs'
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#7c3aed', // primary
          accent: '#f97316'
        }
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui']
      }
    }
  },
  plugins: [
    require('@tailwindcss/typography'),
    require('@tailwindcss/forms'),
    require('@tailwindcss/aspect-ratio')
  ]
} 