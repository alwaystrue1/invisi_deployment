(() => {
const handleMouseMove = (element) => {
    element.addEventListener('mousemove', (e) => {
      const rect = element.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      element.style.setProperty('--mouse-x', `${x}px`);
      element.style.setProperty('--mouse-y', `${y}px`);
    });
  },
  handleMouseLeave = (element) => {
    element.addEventListener('mouseleave', () => {
      element.style.setProperty('--mouse-x', `50%`);
      element.style.setProperty('--mouse-y', `50%`);
    });
  },
  shimmerEffects = document.querySelectorAll('.box-card, .box-hero');

shimmerEffects.forEach(handleMouseMove);
shimmerEffects.forEach(handleMouseLeave);
})();
